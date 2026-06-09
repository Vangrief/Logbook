"""Helpers for reading/writing the key/value settings table."""
import os

from sqlalchemy.orm import Session

from .models import Setting

DEFAULTS = {
    "app_title": "Flight Archive",
    "pilot_name": "",
    "opensky_client_id": "",
    "opensky_client_secret": "",
}


def get_value(db: Session, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    if row is None:
        return DEFAULTS.get(key, default)
    return row.value


def set_value(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value


def get_credentials(db: Session) -> tuple[str, str]:
    return (
        get_value(db, "opensky_client_id"),
        get_value(db, "opensky_client_secret"),
    )


def ensure_defaults(db: Session) -> None:
    # Allow optional one-time bootstrap of OpenSky credentials from the
    # environment (.env). In-app Settings remain the primary source of truth.
    env_overrides = {
        "opensky_client_id": os.environ.get("OPENSKY_CLIENT_ID", ""),
        "opensky_client_secret": os.environ.get("OPENSKY_CLIENT_SECRET", ""),
    }
    for key, value in DEFAULTS.items():
        if db.get(Setting, key) is None:
            db.add(Setting(key=key, value=env_overrides.get(key) or value))
    db.commit()
