"""SQLAlchemy ORM models."""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    DateTime,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Aircraft(Base):
    __tablename__ = "aircraft"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    registration: Mapped[str] = mapped_column(String(16), nullable=False)
    icao24: Mapped[str] = mapped_column(String(6), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    nickname: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)

    flights: Mapped[list["Flight"]] = relationship(
        back_populates="aircraft", cascade="all, delete-orphan"
    )


class Flight(Base):
    __tablename__ = "flights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    aircraft_id: Mapped[int] = mapped_column(
        ForeignKey("aircraft.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # The timestamp the user supplied (a moment DURING the flight) plus the
    # actual flight window resolved by OpenSky.
    query_time: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[int] = mapped_column(Integer, nullable=False)
    end_time: Mapped[int] = mapped_column(Integer, nullable=False)
    callsign: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Raw OpenSky track payload, stored verbatim as JSON text.
    raw_track: Mapped[str] = mapped_column(Text, nullable=False)

    # Pre-computed statistics for fast list rendering.
    duration_s: Mapped[int] = mapped_column(Integer, default=0)
    distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    max_altitude_ft: Mapped[float] = mapped_column(Float, default=0.0)
    avg_altitude_ft: Mapped[float] = mapped_column(Float, default=0.0)
    max_speed_kt: Mapped[float] = mapped_column(Float, default=0.0)
    avg_speed_kt: Mapped[float] = mapped_column(Float, default=0.0)

    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # True while the flight is still airborne and being tracked live.
    is_live: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    aircraft: Mapped["Aircraft"] = relationship(back_populates="flights")


class Setting(Base):
    """Simple key/value store for app configuration and credentials."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
