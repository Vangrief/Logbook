"""First-launch seeding of default aircraft and settings."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Aircraft
from .settings_store import ensure_defaults

# Pre-seeded aircraft. ICAO24 hex is left blank for the operator to fill in
# via the Settings page once known.
SEED_AIRCRAFT = [
    {
        "registration": "HB-EZD",
        "icao24": "",
        "model": "Bristell B23-912iS",
        "nickname": None,
        "color": "#f59e0b",
    },
    {
        "registration": "HB-EZE",
        "icao24": "",
        "model": "Bristell B23-912iS",
        "nickname": None,
        "color": "#22d3ee",
    },
]


def seed(db: Session) -> None:
    ensure_defaults(db)

    existing = db.scalar(select(Aircraft).limit(1))
    if existing is None:
        for entry in SEED_AIRCRAFT:
            db.add(Aircraft(**entry))
        db.commit()
