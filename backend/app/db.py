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
        # --- idempotent migration for SSH metrics columns ---
        expected = {
            "ssh_password_enc": "TEXT",
            "host_key_fp": "TEXT",
            "ssh_status": "TEXT NOT NULL DEFAULT 'unknown'",
            "last_error": "TEXT",
            "cpu_percent": "REAL",
            "mem_percent": "REAL",
            "mem_used_mb": "INTEGER",
            "mem_total_mb": "INTEGER",
            "disk_percent": "REAL",
            "disk_used_gb": "REAL",
            "disk_total_gb": "REAL",
            "uptime_seconds": "INTEGER",
            "last_reboot": "TEXT",
            "last_metrics_at": "TEXT",
            "pinned": "INTEGER NOT NULL DEFAULT 0",
        }
        existing = {
            row["name"] for row in conn.execute("PRAGMA table_info(servers)").fetchall()
        }
        for name, decl in expected.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE servers ADD COLUMN {name} {decl}")


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


def update_username(user_id: int, username: str) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute("UPDATE users SET username = ? WHERE id = ?", (username, user_id))


def update_password(user_id: int, password_hash: str) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (password_hash, user_id),
        )


# ---------------------------------------------------------------- servers


def list_servers() -> list[dict[str, Any]]:
    with closing(get_conn()) as conn:
        rows = conn.execute(
            "SELECT * FROM servers ORDER BY pinned DESC, name COLLATE NOCASE"
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


def set_ssh_password(server_id: int, password_enc: str) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute(
            "UPDATE servers SET ssh_password_enc = ?,"
            " ssh_status = 'unknown', last_error = NULL WHERE id = ?",
            (password_enc, server_id),
        )


def set_ssh_status(server_id: int, status: str, error: Optional[str] = None) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute(
            "UPDATE servers SET ssh_status = ?, last_error = ? WHERE id = ?",
            (status, error, server_id),
        )


def set_host_key_fp(server_id: int, fingerprint: str) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute(
            "UPDATE servers SET host_key_fp = ? WHERE id = ?", (fingerprint, server_id)
        )


def clear_host_key_fp(server_id: int) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute("UPDATE servers SET host_key_fp = NULL WHERE id = ?", (server_id,))


def set_pinned(server_id: int, pinned: bool) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute(
            "UPDATE servers SET pinned = ? WHERE id = ?",
            (1 if pinned else 0, server_id),
        )


def update_metrics(server_id: int, m: dict[str, Any]) -> None:
    with closing(get_conn()) as conn, conn:
        conn.execute(
            """UPDATE servers SET
                   cpu_percent = ?, mem_percent = ?, mem_used_mb = ?, mem_total_mb = ?,
                   disk_percent = ?, disk_used_gb = ?, disk_total_gb = ?,
                   uptime_seconds = ?, last_reboot = ?,
                   ssh_status = 'ok', last_error = NULL,
                   last_metrics_at = datetime('now')
               WHERE id = ?""",
            (
                m["cpu_percent"],
                m["mem_percent"],
                m["mem_used_mb"],
                m["mem_total_mb"],
                m["disk_percent"],
                m["disk_used_gb"],
                m["disk_total_gb"],
                m["uptime_seconds"],
                m.get("last_reboot") or None,
                server_id,
            ),
        )
