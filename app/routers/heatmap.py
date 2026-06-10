"""Heatmap endpoint — all flight tracks for an overlaid map."""
import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Aircraft, Flight

router = APIRouter(prefix="/api/heatmap", tags=["heatmap"])


@router.get("")
def get_heatmap(
    aircraft_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Return every flight's track + metadata, optionally filtered by aircraft."""
    stmt = select(Flight).order_by(Flight.start_time)
    if aircraft_id is not None:
        stmt = stmt.where(Flight.aircraft_id == aircraft_id)

    aircraft = {a.id: a for a in db.scalars(select(Aircraft))}

    flights = []
    for f in db.scalars(stmt):
        try:
            path = json.loads(f.raw_track).get("path") or []
        except (ValueError, TypeError):
            path = []
        ac = aircraft.get(f.aircraft_id)
        flights.append({
            "id": f.id,
            "aircraft_id": f.aircraft_id,
            "registration": ac.registration if ac else None,
            "date": f.start_time,
            "duration_s": f.duration_s,
            "track": path,
        })

    return {"flights": flights, "total_flights": len(flights)}
