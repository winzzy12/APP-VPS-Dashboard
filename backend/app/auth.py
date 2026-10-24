"""Auth helpers: PBKDF2 password hashing + HS256 JWT sessions (stdlib + PyJWT)."""
import hashlib
import hmac
import os
import pathlib
import time
from typing import Any, Optional

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
SECRET_FILE = BASE_DIR / ".secret"
TOKEN_TTL_SECONDS = 24 * 60 * 60
_PBKDF2_ROUNDS = 240_000


def _secret() -> bytes:
    """Load (or lazily generate) the per-install signing key."""
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes().strip()
    key = os.urandom(32).hex().encode()
    SECRET_FILE.write_bytes(key)
    SECRET_FILE.chmod(0o600)
    return key


# ------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, dk_hex = stored.split("$", 2)
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), _PBKDF2_ROUNDS
        )
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------- tokens


def make_token(user_id: int, username: str) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "username": username,
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, _secret(), algorithm="HS256")


_bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict[str, Any]:
    from . import db

    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = db.get_user_by_id(int(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user
