"""Encryption for stored SSH passwords (Fernet, key in backend/.ssh_enc_key)."""
import pathlib

from cryptography.fernet import Fernet, InvalidToken  # noqa: F401 (InvalidToken re-exported)

BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
KEY_FILE = BASE_DIR / ".ssh_enc_key"

__all__ = ["encrypt_secret", "decrypt_secret", "InvalidToken"]


def _fernet() -> Fernet:
    if not KEY_FILE.exists():
        key = Fernet.generate_key()
        KEY_FILE.write_bytes(key)
        KEY_FILE.chmod(0o600)
    return Fernet(KEY_FILE.read_bytes().strip())


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()
