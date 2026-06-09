"""Database engine, session factory and Base for the flight archive."""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Stored under the mounted appdata volume in Docker; falls back to a local
# file for bare-metal / development runs.
DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/flightarchive.db")

# Allow a local default when /data does not exist (e.g. running outside Docker).
if not os.path.isdir(os.path.dirname(DATABASE_PATH) or "."):
    DATABASE_PATH = os.path.join(os.path.dirname(__file__), "..", "flightarchive.db")

DATABASE_URL = f"sqlite:///{os.path.abspath(DATABASE_PATH)}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency that yields a scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
