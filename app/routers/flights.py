"""Flight endpoints: create from OpenSky, list, detail, notes, delete."""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import opensky, stats, weather
from ..database import get_db
from ..models import Aircraft, Flight
from ..schemas import (
    DiscoveredFlight,
    FlightComparison,
    FlightCreate,
    FlightDetail,
    FlightNotesUpdate,
    FlightPatch,
    FlightSummary,
    WeatherData,
)
from ..settings_store import get_credentials

# ±6 hour default search window for flight discovery.
DISCOVERY_WINDOW_S = 6 * 3600
# Tolerance when matching a discovered flight to an already-saved one.
MATCH_TOLERANCE_S = 600

logger = logging.getLogger("logbook.discovery")

router = APIRouter(prefix="/api/flights", tags=["flights"])


def _utc(ts: int) -> str:
    """Format a unix timestamp as a human-readable UTC string for logs."""
    if not ts:
        return "—"
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _to_summary(flight: Flight) -> FlightSummary:
    summary = FlightSummary.model_validate(flight)
    ac = flight.aircraft
    if ac is not None:
        summary.registration = ac.registration
        summary.aircraft_model = ac.model
        summary.nickname = ac.nickname
        summary.color = ac.color
        summary.icao24 = ac.icao24
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


@router.get("/discover", response_model=list[DiscoveredFlight])
async def discover_flights(
    aircraft_id: int = Query(...),
    time: int = Query(..., description="Unix seconds sometime during the flight"),
    window: int = Query(default=DISCOVERY_WINDOW_S, ge=0, le=30 * 24 * 3600),
    db: Session = Depends(get_db),
):
    """Find candidate flights for an aircraft within ±`window` of `time`.

    Queries OpenSky's historical /flights/aircraft endpoint (results are
    cached in memory for 5 minutes) and flags any flights that are already
    stored locally.
    """
    aircraft = db.get(Aircraft, aircraft_id)
    if aircraft is None:
        raise HTTPException(status_code=404, detail="Aircraft not found")
    if not aircraft.icao24:
        raise HTTPException(
            status_code=400,
            detail=f"Aircraft {aircraft.registration} has no ICAO24 hex set. "
            "Add it in Settings.",
        )

    icao24 = aircraft.icao24
    begin = time - window
    end = time + window
    logger.info(
        "Discovery request: icao24=%s reg=%s entered=%s window=[%s .. %s]",
        icao24, aircraft.registration, _utc(time), _utc(begin), _utc(end),
    )

    client_id, client_secret = get_credentials(db)
    try:
        raw_flights = await opensky.fetch_flights(
            icao24, begin, end, client_id, client_secret
        )
    except opensky.OpenSkyError as exc:
        logger.warning("Discovery failed for icao24=%s: %s", icao24, exc.message)
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    existing = list(
        db.scalars(select(Flight).where(Flight.aircraft_id == aircraft_id))
    )

    results: list[DiscoveredFlight] = []
    already_n = 0
    for fl in raw_flights:
        first = int(fl.get("firstSeen") or 0)
        last = int(fl.get("lastSeen") or 0)

        # "Already logged" when an existing flight departed at (about) the same
        # moment: query_time is exactly the firstSeen used when added via
        # discovery; start_time is the track-derived fallback.
        logged_id = None
        for ex in existing:
            if first and (
                abs(ex.query_time - first) <= MATCH_TOLERANCE_S
                or abs(ex.start_time - first) <= MATCH_TOLERANCE_S
            ):
                logged_id = ex.id
                break
        if logged_id is not None:
            already_n += 1

        results.append(
            DiscoveredFlight(
                icao24=(fl.get("icao24") or icao24),
                first_seen=first,
                last_seen=last,
                duration_s=max(0, last - first),
                callsign=(fl.get("callsign") or "").strip() or None,
                est_departure_airport=fl.get("estDepartureAirport"),
                est_arrival_airport=fl.get("estArrivalAirport"),
                already_logged=logged_id is not None,
                logged_flight_id=logged_id,
            )
        )

    results.sort(key=lambda r: r.first_seen, reverse=True)

    logger.info(
        "Discovery result: icao24=%s flights_returned=%d already_logged=%d",
        icao24, len(results), already_n,
    )
    for r in results:
        logger.info(
            "  dep=%s arr=%s already_logged=%s",
            _utc(r.first_seen), _utc(r.last_seen) if r.last_seen else "—",
            r.already_logged,
        )

    return results


def _detail(flight: Flight) -> FlightDetail:
    raw = json.loads(flight.raw_track)
    return FlightDetail(
        **_to_summary(flight).model_dump(),
        query_time=flight.query_time,
        track=raw.get("path", []),
    )


# Declared before /{flight_id} so "compare" isn't parsed as a flight id.
@router.get("/compare", response_model=FlightComparison)
def compare_flights(
    a: int = Query(...), b: int = Query(...), db: Session = Depends(get_db)
):
    """Full detail for two flights in one response (comparison page)."""
    fa = db.get(Flight, a)
    fb = db.get(Flight, b)
    if fa is None or fb is None:
        raise HTTPException(status_code=404, detail="Flight not found")
    return FlightComparison(flight_a=_detail(fa), flight_b=_detail(fb))


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


@router.patch("/{flight_id}", response_model=FlightDetail)
async def patch_flight(
    flight_id: int, payload: FlightPatch, db: Session = Depends(get_db)
):
    """Incremental live-tracking update: append a point, or finalize the flight."""
    flight = db.get(Flight, flight_id)
    if flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")

    raw = json.loads(flight.raw_track)
    path = raw.get("path") or []

    if payload.finalize:
        # Landing detected — pull the full, authoritative track from OpenSky.
        flight.is_live = False
        aircraft = flight.aircraft
        client_id, client_secret = get_credentials(db)
        try:
            full = await opensky.fetch_track(
                aircraft.icao24, flight.query_time, client_id, client_secret
            )
            if full and full.get("path"):
                raw = full
                path = full.get("path") or path
        except opensky.OpenSkyError:
            # Keep the incrementally-built track if the final fetch fails.
            pass

    if payload.append_point is not None:
        p = payload.append_point
        last_t = path[-1][0] if path else None
        # Only append a genuinely newer fix (avoid duplicates).
        if p and p[0] is not None and (last_t is None or p[0] > last_t):
            path.append(p)
        raw["path"] = path

    if payload.end_time is not None:
        flight.end_time = payload.end_time

    # Recompute window + stats from the current path.
    raw.setdefault("startTime", flight.start_time)
    if path:
        raw["endTime"] = path[-1][0]
        flight.end_time = int(path[-1][0])
    for key, value in stats.compute(raw).items():
        setattr(flight, key, value)
    flight.raw_track = json.dumps(raw)

    db.commit()
    db.refresh(flight)

    return FlightDetail(
        **_to_summary(flight).model_dump(),
        query_time=flight.query_time,
        track=raw.get("path", []),
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


@router.get("/{flight_id}/weather", response_model=WeatherData)
async def get_flight_weather(flight_id: int, db: Session = Depends(get_db)):
    """Historical weather at the takeoff point, fetched lazily and cached."""
    flight = db.get(Flight, flight_id)
    if flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")

    if flight.weather_cache:
        return WeatherData(**json.loads(flight.weather_cache))

    raw = json.loads(flight.raw_track)
    first = next(
        (p for p in (raw.get("path") or []) if p[1] is not None and p[2] is not None),
        None,
    )
    if first is None:
        raise HTTPException(status_code=404, detail="Flight has no track data")

    lat, lon = first[1], first[2]
    departure_ts = int(first[0] or flight.start_time)

    data = await weather.fetch_weather(lat, lon, departure_ts)
    if data is None:
        raise HTTPException(status_code=502, detail="Weather data unavailable")

    flight.weather_cache = json.dumps(data)
    db.commit()
    return WeatherData(**data)


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
