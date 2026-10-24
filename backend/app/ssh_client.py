"""SSH metrics collection via paramiko.

Security rules:
- Password is used for this operation only, never logged or stored in clear text.
- Host keys: TOFU — the first fingerprint seen is stored per server; a changed
  key refuses the connection (HOST_KEY_CHANGED) until an admin resets it.
- Error strings are sanitized before being persisted (no secrets, one line).
"""
import base64
import hashlib
import socket
from dataclasses import dataclass
from typing import Any, Optional

import paramiko

CONNECT_TIMEOUT = 8
EXEC_TIMEOUT = 12

METRICS_SCRIPT = """\
C1=$(head -n1 /proc/stat)
sleep 1
C2=$(head -n1 /proc/stat)
echo "CPU1|$C1"
echo "CPU2|$C2"
awk '/^MemTotal:/{print "MEMTOTAL|"$2} /^MemAvailable:/{print "MEMAVAIL|"$2}' /proc/meminfo
df -kP / | awk 'NR==2{print "DISKTOTAL|"$2; print "DISKUSED|"$3}'
awk '{print "UPTIME|"$1}' /proc/uptime
RB=$(uptime -s 2>/dev/null)
if [ -n "$RB" ]; then echo "REBOOT|$RB"; else who -b 2>/dev/null | awk '{print "REBOOT|"$3" "$4}'; fi
"""


@dataclass
class SSHResult:
    ok: bool
    error: Optional[str] = None
    fingerprint: Optional[str] = None
    metrics: Optional[dict[str, Any]] = None


def _fingerprint(key: paramiko.PKey) -> str:
    digest = hashlib.sha256(key.get_fingerprint()).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


class _TofuPolicy(paramiko.MissingHostKeyPolicy):
    """Accepts the first key seen; refuses a key that differs from the stored one."""

    def __init__(self, stored_fp: Optional[str]):
        self.stored_fp = stored_fp
        self.seen_fp: Optional[str] = None

    def missing_host_key(self, client, hostname, key) -> None:
        fp = _fingerprint(key)
        self.seen_fp = fp
        if self.stored_fp and self.stored_fp != fp:
            raise paramiko.SSHException("HOST_KEY_CHANGED")


def _sanitize(msg: object) -> str:
    return str(msg).replace("\n", " ").replace("\r", " ").strip()[:300]


def parse_metrics(out: str) -> Optional[dict[str, Any]]:
    vals: dict[str, str] = {}
    for line in out.splitlines():
        if "|" in line:
            key, _, value = line.partition("|")
            vals[key.strip()] = value.strip()
    try:
        c1 = [int(x) for x in vals["CPU1"].split()[1:]]
        c2 = [int(x) for x in vals["CPU2"].split()[1:]]
        idle1 = c1[3] + (c1[4] if len(c1) > 4 else 0)  # idle + iowait
        idle2 = c2[3] + (c2[4] if len(c2) > 4 else 0)
        total1, total2 = sum(c1), sum(c2)
        cpu = 0.0 if total2 <= total1 else (1 - (idle2 - idle1) / (total2 - total1)) * 100

        mem_total = int(vals["MEMTOTAL"])
        mem_avail = int(vals["MEMAVAIL"])
        mem_used = mem_total - mem_avail

        disk_total = int(vals["DISKTOTAL"])
        disk_used = int(vals["DISKUSED"])

        return {
            "cpu_percent": round(max(0.0, min(cpu, 100.0)), 1),
            "mem_percent": round(mem_used / mem_total * 100, 1),
            "mem_used_mb": round(mem_used / 1024),
            "mem_total_mb": round(mem_total / 1024),
            "disk_percent": round(disk_used / disk_total * 100, 1),
            "disk_used_gb": round(disk_used / 1048576, 1),
            "disk_total_gb": round(disk_total / 1048576, 1),
            "uptime_seconds": int(float(vals["UPTIME"])),
            "last_reboot": vals.get("REBOOT") or None,
        }
    except (KeyError, ValueError, ZeroDivisionError, IndexError):
        return None


def collect_metrics(
    host: str,
    port: int,
    username: str,
    password: str,
    stored_fp: Optional[str] = None,
    timeout: float = CONNECT_TIMEOUT,
) -> SSHResult:
    client = paramiko.SSHClient()
    policy = _TofuPolicy(stored_fp)
    client.set_missing_host_key_policy(policy)
    try:
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=timeout,
            auth_timeout=timeout,
            banner_timeout=timeout,
            channel_timeout=timeout,
            look_for_keys=False,
            allow_agent=False,
        )
        fp = policy.seen_fp or stored_fp
        _stdin, stdout, _stderr = client.exec_command(METRICS_SCRIPT, timeout=EXEC_TIMEOUT)
        out = stdout.read().decode("utf-8", "replace")
        metrics = parse_metrics(out)
        if metrics is None:
            return SSHResult(False, "Connected, but metrics output could not be parsed.", fp)
        return SSHResult(True, None, fp, metrics)
    except paramiko.SSHException as exc:
        raw = _sanitize(exc)
        if "HOST_KEY_CHANGED" in raw:
            return SSHResult(
                False,
                "Host key changed since first connect. Verify the server, then reset the stored host key.",
                policy.seen_fp,
            )
        if "authentication" in raw.lower() or "auth" in raw.lower():
            return SSHResult(
                False,
                "SSH authentication failed — check username and password.",
                policy.seen_fp,
            )
        return SSHResult(False, f"SSH error: {raw}", policy.seen_fp)
    except (socket.timeout, OSError) as exc:
        return SSHResult(False, f"Connection failed: {_sanitize(exc)}")
    finally:
        client.close()
