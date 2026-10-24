"""Interactive SSH terminal over WebSocket (xterm.js protocol).

Auth: first WS message must be {"type":"auth","token":"<JWT>"} — the token is
kept out of the URL so it never lands in access logs. The SSH session uses the
stored (encrypted) credentials of the server; the password never crosses the
WebSocket. Host keys follow the same TOFU policy as metrics collection.
"""
import asyncio
import json
import socket
from typing import Any, Optional

import paramiko
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from . import db
from .auth import decode_token
from .crypto import InvalidToken, decrypt_secret
from .ssh_client import _TofuPolicy

router = APIRouter()

AUTH_TIMEOUT = 10
CONNECT_TIMEOUT = 8


def _sanitize(msg: object) -> str:
    return str(msg).replace("\n", " ").replace("\r", " ").strip()[:200]


async def _connect_ssh(
    server: dict[str, Any], password: str
) -> tuple[Optional[paramiko.SSHClient], Optional[paramiko.Channel], Optional[str], Optional[str]]:
    """Blocking connect + invoke_shell in a worker thread."""

    def work() -> tuple[
        Optional[paramiko.SSHClient],
        Optional[paramiko.Channel],
        Optional[str],
        Optional[str],
    ]:
        client = paramiko.SSHClient()
        policy = _TofuPolicy(server.get("host_key_fp"))
        client.set_missing_host_key_policy(policy)
        try:
            client.connect(
                hostname=server["host"],
                port=server["port"],
                username=server["ssh_user"],
                password=password,
                timeout=CONNECT_TIMEOUT,
                auth_timeout=CONNECT_TIMEOUT,
                banner_timeout=CONNECT_TIMEOUT,
                channel_timeout=CONNECT_TIMEOUT,
                look_for_keys=False,
                allow_agent=False,
            )
            transport = client.get_transport()
            if transport:
                transport.set_keepalive(15)
            channel = client.invoke_shell(term="xterm-256color", width=80, height=24)
            channel.settimeout(1.0)
            fp = policy.seen_fp or server.get("host_key_fp")
            return client, channel, fp, None
        except paramiko.SSHException as exc:
            raw = _sanitize(exc)
            try:
                client.close()
            except Exception:
                pass
            if "HOST_KEY_CHANGED" in raw:
                return (
                    None,
                    None,
                    policy.seen_fp,
                    "Host key changed since first connect — verify the server, then reset the stored host key.",
                )
            if "auth" in raw.lower():
                return None, None, policy.seen_fp, "SSH authentication failed — check the stored credentials."
            return None, None, policy.seen_fp, f"SSH error: {raw}"
        except (socket.timeout, OSError) as exc:
            try:
                client.close()
            except Exception:
                pass
            return None, None, None, f"Connection failed: {_sanitize(exc)}"

    return await asyncio.to_thread(work)


def _close_session(
    channel: Optional[paramiko.Channel], client: Optional[paramiko.SSHClient]
) -> None:
    for obj in (channel, client):
        try:
            if obj is not None:
                obj.close()
        except Exception:
            pass


@router.websocket("/api/servers/{server_id}/terminal")
async def terminal(ws: WebSocket, server_id: int) -> None:
    await ws.accept()

    # ---- first message must carry the JWT (kept out of the URL) ----
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=AUTH_TIMEOUT)
    except (asyncio.TimeoutError, WebSocketDisconnect, RuntimeError):
        try:
            await ws.close(code=4401)
        except Exception:
            pass
        return
    try:
        token = str(json.loads(raw).get("token", ""))
    except (ValueError, AttributeError):
        token = ""
    payload = decode_token(token)
    user = db.get_user_by_id(int(payload["sub"])) if payload else None
    if user is None:
        await ws.send_json({"type": "error", "message": "Invalid or expired session"})
        await ws.close(code=4401)
        return

    server = db.get_server(server_id)
    if server is None:
        await ws.send_json({"type": "error", "message": "Server not found"})
        await ws.close(code=4404)
        return
    enc = server.get("ssh_password_enc")
    if not enc:
        await ws.send_json(
            {"type": "error", "message": "No SSH password stored — edit the server first."}
        )
        await ws.close(code=4400)
        return
    try:
        password = decrypt_secret(enc)
    except InvalidToken:
        await ws.send_json(
            {"type": "error", "message": "Stored credentials cannot be decrypted."}
        )
        await ws.close(code=4400)
        return

    client, channel, fp, error = await _connect_ssh(server, password)
    if fp and fp != server.get("host_key_fp"):
        db.set_host_key_fp(server_id, fp)
    if error or client is None or channel is None:
        await ws.send_json({"type": "error", "message": error or "SSH connection failed"})
        await ws.close(code=4400)
        return

    await ws.send_json({"type": "ready", "fingerprint": fp})

    stop = asyncio.Event()

    async def pump_output() -> None:
        try:
            while not stop.is_set():
                try:
                    data = await asyncio.to_thread(channel.recv, 8192)
                except socket.timeout:
                    continue
                except Exception:
                    break
                if not data:
                    break
                try:
                    await ws.send_text(data.decode("utf-8", "replace"))
                except Exception:
                    break
        finally:
            if not stop.is_set():
                stop.set()
                try:
                    await ws.close(code=1000)
                except Exception:
                    pass

    async def pump_input() -> None:
        while True:
            raw = await ws.receive_text()
            data = raw
            try:
                obj = json.loads(raw)
            except ValueError:
                obj = None
            if isinstance(obj, dict):
                if obj.get("type") == "resize":
                    try:
                        cols = max(20, min(int(obj.get("cols", 80)), 500))
                        rows = max(5, min(int(obj.get("rows", 24)), 200))
                        await asyncio.to_thread(channel.resize_pty, cols, rows)
                    except (ValueError, OSError, paramiko.SSHException):
                        pass
                    continue
                if obj.get("type") == "input":
                    data = str(obj.get("data", ""))
            if data:
                await asyncio.to_thread(channel.sendall, data)

    out_task = asyncio.create_task(pump_output())
    try:
        await pump_input()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        stop.set()
        out_task.cancel()
        await asyncio.gather(out_task, return_exceptions=True)
        await asyncio.to_thread(_close_session, channel, client)
        try:
            await ws.close()
        except Exception:
            pass
