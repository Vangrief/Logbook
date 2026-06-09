"""Statistics dashboard endpoint.

Everything is computed on the fly from the existing flights/aircraft tables —
no new tables, no stored aggregates. Day/month bucketing uses Europe/Zurich so
it lines up with the flight-list day grouping.
"""
import calendar
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Aircraft, Flight
from ..stats import _haversine_m

router = APIRouter(prefix="/api/stats", tags=["stats"])

ZRH = ZoneInfo("Europe/Zurich")
AIRPORT_RADIUS_M = 2000  # cluster start/end positions within 2 km


def _zdt(ts: int) -> datetime:
    return datetime.fromtimestamp(ts, ZRH)


def _count_airport_clusters(points, radius_m: int = AIRPORT_RADIUS_M) -> int:
    """Greedy clustering: a point joins an existing cluster if within radius."""
    clusters: list[tuple[float, float]] = []
    for lat, lon in points:
        if any(_haversine_m(lat, lon, c[0], c[1]) <= radius_m for c in clusters):
            continue
        clusters.append((lat, lon))
    return len(clusters)


@router.get("")
def get_stats(db: Session = Depends(get_db)):
    flights = list(db.scalars(select(Flight)))
    aircraft = list(db.scalars(select(Aircraft).order_by(Aircraft.registration)))

    # ---- Totals ----
    total_flights = len(flights)
    total_time_s = sum(f.duration_s or 0 for f in flights)
    total_distance_km = round(sum(f.distance_km or 0.0 for f in flights), 1)

    # Airports: cluster the first/last fix of every flight that has a track.
    points: list[tuple[float, float]] = []
    for f in flights:
        try:
            path = json.loads(f.raw_track).get("path") or []
        except (ValueError, TypeError):
            path = []
        for wp in (path[:1] + path[-1:]):
            lat, lon = wp[1], wp[2]
            if lat is not None and lon is not None:
                points.append((lat, lon))
    total_airports = _count_airport_clusters(points)

    # ---- Personal records ----
    def rec(flight, attr):
        if flight is None:
            return None
        return {
            "flight_id": flight.id,
            "date": flight.start_time,
            "value": getattr(flight, attr),
        }

    records = {
        "longest": rec(max(flights, key=lambda f: f.duration_s or 0, default=None),
                       "duration_s"),
        "furthest": rec(max(flights, key=lambda f: f.distance_km or 0, default=None),
                        "distance_km"),
        "highest": rec(max(flights, key=lambda f: f.max_altitude_ft or 0, default=None),
                       "max_altitude_ft"),
        "fastest": rec(max(flights, key=lambda f: f.max_speed_kt or 0, default=None),
                       "max_speed_kt"),
    }

    # ---- Monthly buckets (last 12 months, oldest first) ----
    now = datetime.now(ZRH)
    months: list[tuple[int, int]] = []
    y, m = now.year, now.month
    for _ in range(12):
        months.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    months.reverse()
    index = {ym: i for i, ym in enumerate(months)}

    m_flights = [0] * 12
    m_time = [0] * 12
    m_dist = [0.0] * 12
    for f in flights:
        d = _zdt(f.start_time)
        i = index.get((d.year, d.month))
        if i is not None:
            m_flights[i] += 1
            m_time[i] += f.duration_s or 0
            m_dist[i] += f.distance_km or 0.0

    labels = []
    for (yy, mm) in months:
        lab = calendar.month_abbr[mm]
        labels.append(f"{lab} {yy % 100:02d}" if mm == 1 else lab)

    monthly = {
        "labels": labels,
        "flights": m_flights,
        "time_s": m_time,
        "distance_km": [round(x, 1) for x in m_dist],
    }

    # ---- Activity ----
    day_counts = Counter(_zdt(f.start_time).date() for f in flights)
    days = sorted(day_counts)
    day_set = set(days)

    longest_streak = 0
    run = 0
    prev = None
    for d in days:
        run = run + 1 if (prev is not None and (d - prev).days == 1) else 1
        longest_streak = max(longest_streak, run)
        prev = d

    today = now.date()
    yesterday = today - timedelta(days=1)
    anchor = today if today in day_set else (yesterday if yesterday in day_set else None)
    current_streak = 0
    if anchor is not None:
        d = anchor
        while d in day_set:
            current_streak += 1
            d -= timedelta(days=1)

    busiest_day = None
    if day_counts:
        bd, bc = max(day_counts.items(), key=lambda kv: kv[1])
        busiest_day = {"date": bd.isoformat(), "count": bc}

    avg_duration_s = int(total_time_s / total_flights) if total_flights else 0
    cutoff = now.timestamp() - 56 * 86400  # last 8 weeks
    recent = sum(1 for f in flights if f.start_time >= cutoff)
    avg_flights_per_week = round(recent / 8.0, 1)

    activity = {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "busiest_day": busiest_day,
        "avg_duration_s": avg_duration_s,
        "avg_flights_per_week": avg_flights_per_week,
    }

    # ---- Per-aircraft breakdown ----
    agg = defaultdict(lambda: {"flights": 0, "time_s": 0, "distance_km": 0.0})
    for f in flights:
        a = agg[f.aircraft_id]
        a["flights"] += 1
        a["time_s"] += f.duration_s or 0
        a["distance_km"] += f.distance_km or 0.0

    per_aircraft = []
    for ac in aircraft:
        a = agg.get(ac.id, {"flights": 0, "time_s": 0, "distance_km": 0.0})
        per_aircraft.append({
            "aircraft_id": ac.id,
            "registration": ac.registration,
            "nickname": ac.nickname,
            "flights": a["flights"],
            "time_s": a["time_s"],
            "distance_km": round(a["distance_km"], 1),
            "avg_duration_s": int(a["time_s"] / a["flights"]) if a["flights"] else 0,
        })
    per_aircraft.sort(key=lambda r: r["flights"], reverse=True)

    return {
        "totals": {
            "flights": total_flights,
            "time_s": total_time_s,
            "distance_km": total_distance_km,
            "airports": total_airports,
        },
        "records": records,
        "monthly": monthly,
        "activity": activity,
        "per_aircraft": per_aircraft,
    }
