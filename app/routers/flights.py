"""Flight endpoints: create from OpenSky, list, detail, notes, delete."""
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import opensky, stats
from ..database import get_db
from ..models import Aircraft, Flight
from ..schemas import (
    FlightCreate,
    FlightDetail,
    FlightNotesUpdate,
    FlightSummary,
)
from ..settings_store import get_credentials

router = APIRouter(prefix="/api/flights", tags=["flights"])


def _to_summary(flight: Flight) -> FlightSummary:
    summary = FlightSummary.model_validate(flight)
    ac = flight.aircraft
    if ac is not None:
        summary.registration = ac.registration
        summary.aircraft_model = ac.model
        summary.nickname = ac.nickname
        summary.color = ac.color
    return summary


@router.get("", response_model=list[FlightSummary])
def list_flights(
    aircraft_id: int | None = Query(default=None),
    sort: str = Query(default="date"),
    order: str = Query(default="desc"),
    db: Session = Depends(get_db),
):
    stmt = select(Flight)
    if aircraft_id is not None:
        stmt = stmt.where(Flight.aircraft_id == aircraft_id)

    sort_columns = {
        "date": Flight.start_time,
        "duration": Flight.duration_s,
        "distance": Flight.distance_km,
        "altitude": Flight.max_altitude_ft,
        "speed": Flight.max_speed_kt,
    }
    column = sort_columns.get(sort, Flight.start_time)
    stmt = stmt.order_by(column.asc() if order == "asc" else column.desc())

    return [_to_summary(f) for f in db.scalars(stmt)]


@router.post("", response_model=FlightDetail, status_code=201)
async def create_flight(payload: FlightCreate, db: Session = Depends(get_db)):
    aircraft = db.get(Aircraft, payload.aircraft_id)
    if aircraft is None:
        raise HTTPException(status_code=404, detail="Aircraft not found")
    if not aircraft.icao24:
        raise HTTPException(
            status_code=400,
            detail=f"Aircraft {aircraft.registration} has no ICAO24 hex set. "
            "Add it in Settings.",
        )

    client_id, client_secret = get_credentials(db)
    try:
        track = await opensky.fetch_track(
            aircraft.icao24, payload.time, client_id, client_secret
        )
    except opensky.OpenSkyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    computed = stats.compute(track)

    flight = Flight(
        aircraft_id=aircraft.id,
        query_time=payload.time,
        start_time=int(track.get("startTime") or track["path"][0][0]),
        end_time=int(track.get("endTime") or track["path"][-1][0]),
        callsign=(track.get("callsign") or "").strip() or None,
        raw_track=json.dumps(track),
        notes=payload.notes or "",
        **computed,
    )
    db.add(flight)
    db.commit()
    db.refresh(flight)

    return FlightDetail(
        **_to_summary(flight).model_dump(),
        query_time=flight.query_time,
        track=track.get("path", []),
    )


@router.get("/{flight_id}", response_model=FlightDetail)
def get_flight(flight_id: int, db: Session = Depends(get_db)):
    flight = db.get(Flight, flight_id)
    if flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")

    raw = json.loads(flight.raw_track)
    return FlightDetail(
        **_to_summary(flight).model_dump(),
        query_time=flight.query_time,
        track=raw.get("path", []),
    )


@router.put("/{flight_id}/notes", response_model=FlightSummary)
def update_notes(
    flight_id: int, payload: FlightNotesUpdate, db: Session = Depends(get_db)
):
    flight = db.get(Flight, flight_id)
    if flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")
    flight.notes = payload.notes
    db.commit()
    db.refresh(flight)
    return _to_summary(flight)


@router.delete("/{flight_id}", status_code=204)
def delete_flight(flight_id: int, db: Session = Depends(get_db)):
    flight = db.get(Flight, flight_id)
    if flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")
    db.delete(flight)
    db.commit()
