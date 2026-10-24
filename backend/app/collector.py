"""Background metrics collector: SSH into credential-carrying servers every 15s."""
import asyncio
import logging
import time
from collections import deque
from typing import Any

from . import db, ssh_client
from .crypto import InvalidToken, decrypt_secret

log = logging.getLogger("vpsdash.collector")

INTERVAL_SECONDS = 15
HISTORY_LEN = 240  # 1 hour of samples at 15s

_history: dict[int, deque[dict[str, Any]]] = {}


def history_for(server_id: int) -> list[dict[str, Any]]:
    return list(_history.get(server_id, ()))


def forget(server_id: int) -> None:
    _history.pop(server_id, None)


def push_sample(server_id: int, sample: dict[str, Any]) -> None:
    dq = _history.setdefault(server_id, deque(maxlen=HISTORY_LEN))
    dq.append(sample)


async def probe(server: dict[str, Any]) -> ssh_client.SSHResult:
    """Collect metrics from one server now; update DB status + history."""
    enc = server.get("ssh_password_enc")
    if not enc:
        return ssh_client.SSHResult(False, "No SSH password stored for this server.")
    try:
        password = decrypt_secret(enc)
    except InvalidToken:
        err = "Stored credentials cannot be decrypted (encryption key mismatch)."
        db.set_ssh_status(server["id"], "error", err)
        return ssh_client.SSHResult(False, err)
    try:
        result = await asyncio.to_thread(
            ssh_client.collect_metrics,
            server["host"],
            server["port"],
            server["ssh_user"],
            password,
            server.get("host_key_fp"),
        )
    except Exception as exc:  # defensive: one bad server must never kill the loop
        err = f"SSH collector error: {_one_line(exc)}"
        db.set_ssh_status(server["id"], "error", err)
        return ssh_client.SSHResult(False, err)

    if result.fingerprint and result.fingerprint != server.get("host_key_fp"):
        db.set_host_key_fp(server["id"], result.fingerprint)
    if result.ok and result.metrics:
        push_sample(server["id"], {"ts": int(time.time()), **result.metrics})
        db.update_metrics(server["id"], result.metrics)
    else:
        db.set_ssh_status(server["id"], "error", result.error or "Unknown SSH error")
    return result


def _one_line(exc: BaseException) -> str:
    return str(exc).replace("\n", " ").strip()[:200]


async def collect_one(server: dict[str, Any]) -> None:
    await probe(server)


async def loop() -> None:
    while True:
        try:
            servers = db.list_servers()
            if servers:
                await asyncio.gather(*(collect_one(s) for s in servers))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("collector cycle failed")
        await asyncio.sleep(INTERVAL_SECONDS)
