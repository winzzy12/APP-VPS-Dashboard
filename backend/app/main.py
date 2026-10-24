"""VPS Dashboard — FastAPI backend + static SPA host (127.0.0.1:8081)."""
import pathlib
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .auth import current_user, hash_password, make_token, verify_password

ROOT_DIR = pathlib.Path(__file__).resolve().parents[2]
DIST_DIR = ROOT_DIR / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield


app = FastAPI(
    title="VPS Dashboard",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


# ---------------------------------------------------------------- schemas


class SetupIn(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class ServerIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=22, ge=1, le=65535)
    ssh_user: str = Field(default="root", max_length=32)
    os: str = Field(default="", max_length=64)
    notes: str = Field(default="", max_length=2000)


# ---------------------------------------------------------------- helpers


def tcp_check(host: str, port: int, timeout: float = 2.5) -> tuple[str, Optional[int]]:
    """TCP connect probe. Returns (status, latency_ms)."""
    start = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return "online", int((time.monotonic() - start) * 1000)
    except OSError:
        return "offline", None


# ---------------------------------------------------------------- auth


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "vps-dashboard"}


@app.get("/api/auth/status")
def auth_status() -> dict[str, bool]:
    return {"initialized": db.count_users() > 0}


@app.post("/api/auth/setup")
def auth_setup(body: SetupIn) -> dict[str, Any]:
    if db.count_users() > 0:
        raise HTTPException(status_code=403, detail="Initial setup already completed")
    user_id = db.create_user(body.username.strip(), hash_password(body.password))
    return {
        "token": make_token(user_id, body.username.strip()),
        "user": {"id": user_id, "username": body.username.strip()},
    }


@app.post("/api/auth/login")
def auth_login(body: LoginIn) -> dict[str, Any]:
    user = db.get_user_by_username(body.username.strip())
    if user is None or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {
        "token": make_token(user["id"], user["username"]),
        "user": {"id": user["id"], "username": user["username"]},
    }


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(current_user)) -> dict[str, Any]:
    return {"id": user["id"], "username": user["username"]}


# ---------------------------------------------------------------- servers


@app.get("/api/servers")
def servers_list(_: dict = Depends(current_user)) -> list[dict[str, Any]]:
    return db.list_servers()


@app.post("/api/servers", status_code=201)
def servers_create(body: ServerIn, _: dict = Depends(current_user)) -> dict[str, Any]:
    return db.create_server(
        body.name.strip(),
        body.host.strip(),
        body.port,
        body.ssh_user.strip() or "root",
        body.os.strip(),
        body.notes.strip(),
    )


@app.put("/api/servers/{server_id}")
def servers_update(
    server_id: int, body: ServerIn, _: dict = Depends(current_user)
) -> dict[str, Any]:
    if db.get_server(server_id) is None:
        raise HTTPException(status_code=404, detail="Server not found")
    updated = db.update_server(
        server_id,
        {
            "name": body.name.strip(),
            "host": body.host.strip(),
            "port": body.port,
            "ssh_user": body.ssh_user.strip() or "root",
            "os": body.os.strip(),
            "notes": body.notes.strip(),
        },
    )
    assert updated is not None
    return updated


@app.delete("/api/servers/{server_id}", status_code=204)
def servers_delete(server_id: int, _: dict = Depends(current_user)) -> None:
    if not db.delete_server(server_id):
        raise HTTPException(status_code=404, detail="Server not found")


@app.post("/api/servers/check-all")
def servers_check_all(_: dict = Depends(current_user)) -> list[dict[str, Any]]:
    servers = db.list_servers()
    if servers:

        def job(s: dict[str, Any]) -> None:
            status, latency = tcp_check(s["host"], s["port"])
            db.set_server_status(s["id"], status, latency)

        with ThreadPoolExecutor(max_workers=min(16, len(servers))) as pool:
            list(pool.map(job, servers))
    return db.list_servers()


@app.post("/api/servers/{server_id}/check")
def servers_check(server_id: int, _: dict = Depends(current_user)) -> dict[str, Any]:
    server = db.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")
    status, latency = tcp_check(server["host"], server["port"])
    db.set_server_status(server_id, status, latency)
    updated = db.get_server(server_id)
    assert updated is not None
    return updated


# ---------------------------------------------------------------- static SPA

if (DIST_DIR / "index.html").is_file():
    app.mount(
        "/assets",
        StaticFiles(directory=DIST_DIR / "assets"),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = (DIST_DIR / full_path).resolve() if full_path else None
        if (
            candidate is not None
            and candidate.is_file()
            and candidate.is_relative_to(DIST_DIR.resolve())
        ):
            return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")

else:

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_placeholder(full_path: str):
        if full_path.startswith("api"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        return JSONResponse(
            {"detail": "Frontend not built — run `npm run build` in frontend/"},
            status_code=503,
        )
