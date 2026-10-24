"""SQLite data layer for VPS Dashboard."""
import pathlib
import sqlite3
from contextlib import closing
from typing import Any, Optional

BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def init_db() -> None:
    with closing(get_conn()) as conn, conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS servers (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL,
                host         TEXT NOT NULL,
                port         INTEGER NOT NULL DEFAULT 22,
                ssh_user     TEXT NOT NULL DEFAULT 'root',
                os           TEXT NOT NULL DEFAULT '',
                notes        TEXT NOT NULL DEFAULT '',
                status       TEXT NOT NULL DEFAULT 'unknown',
                latency_ms   INTEGER,
                last_checked TEXT,
                created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )


def _row(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
    return dict(row) if row is not None else None


# ---------------------------------------------------------------- users


def count_users() -> int:
    with closing(get_conn()) as conn:
        return int(conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"])


def create_user(username: str, password_hash: str) -> int:
    with closing(get_conn()) as conn, conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, password_hash),
        )
        return int(cur.lastrowid)


def get_user_by_username(username: str) -> Optional[dict[str, Any]]:
    with closing(get_conn()) as conn:
        return _row(
            conn.execute(
                "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
            ).fetchone()
        )


def get_user_by_id(user_id: int) -> Optional[dict[str, Any]]:
    with closing(get_conn()) as conn:
        return _row(
            conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        )


# ---------------------------------------------------------------- servers


def list_servers() -> list[dict[str, Any]]:
    with closing(get_conn()) as conn:
        rows = conn.execute(
            "SELECT * FROM servers ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [dict(r) for r in rows]


def get_server(server_id: int) -> Optional[dict[str, Any]]:
    with closing(get_conn()) as conn:
        return _row(
            conn.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
        )


def create_server(
    name: str, host: str, port: int, ssh_user: str, os_name: str, notes: str
) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn:
        cur = conn.execute(
            "INSERT INTO servers (name, host, port, ssh_user, os, notes)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (name, host, port, ssh_user, os_name, notes),
        )
        row = conn.execute(
            "SELECT * FROM servers WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return dict(row)


def update_server(server_id: int, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    allowed = ("name", "host", "port", "ssh_user", "os", "notes")
    sets = {k: v for k, v in fields.items() if k in allowed}
    if sets:
        cols = ", ".join(f"{k} = ?" for k in sets)
        with closing(get_conn()) as conn, conn:
            conn.execute(
                f"UPDATE servers SET {cols} WHERE id = ?", (*sets.values(), server_id)
            )
    return get_server(server_id)


def delete_server(server_id: int) -> bool:
    with closing(get_conn()) as conn, conn:
        cur = conn.execute("DELETE FROM servers WHERE id = ?", (server_id,))
        return cur.rowcount > 0


def set_server_status(server_id: int, status: str, latency_ms: Optional[int]) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute(
            "UPDATE servers SET status = ?, latency_ms = ?,"
            " last_checked = datetime('now') WHERE id = ?",
            (status, latency_ms, server_id),
        )
