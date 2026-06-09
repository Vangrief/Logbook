"""Track statistics: distance, altitude and speed derived from a track."""
import json
import math

M_TO_FT = 3.28084
MS_TO_KT = 1.94384

# Two GPS fixes within this distance are treated as the same airport/airfield.
AIRPORT_RADIUS_M = 2000


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    """Great-circle distance between two points in metres."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def cluster_airports(flights, radius_m: int = AIRPORT_RADIUS_M) -> list[dict]:
    """Cluster the departure/arrival positions of `flights` into airports.

    Each flight contributes its first and last GPS fix. Fixes within
    `radius_m` of an existing cluster join it (greedy). Returns one dict per
    unique airport with a centroid, visit count, first/last visit timestamps
    and the list of flights that touched it.

    Shared by the /api/stats airport count and the /api/airports map so the
    2 km clustering logic lives in exactly one place.
    """
    clusters: list[dict] = []

    for f in flights:
        try:
            path = json.loads(f.raw_track).get("path") or []
        except (ValueError, TypeError):
            path = []
        if not path:
            continue

        for wp in (path[0], path[-1]):
            lat, lon = wp[1], wp[2]
            if lat is None or lon is None:
                continue

            target = None
            for c in clusters:
                if _haversine_m(lat, lon, c["rep"][0], c["rep"][1]) <= radius_m:
                    target = c
                    break
            if target is None:
                target = {"rep": (lat, lon), "lat_sum": 0.0, "lon_sum": 0.0,
                          "n": 0, "flights": {}}
                clusters.append(target)

            target["lat_sum"] += lat
            target["lon_sum"] += lon
            target["n"] += 1
            # A flight touching an airport twice (e.g. circuits) counts once.
            target["flights"][f.id] = f

    result = []
    for c in clusters:
        fls = sorted(c["flights"].values(), key=lambda f: f.start_time)
        result.append({
            "lat": round(c["lat_sum"] / c["n"], 6),
            "lon": round(c["lon_sum"] / c["n"], 6),
            "visits": len(fls),
            "first_visit": fls[0].start_time,
            "last_visit": fls[-1].start_time,
            "flights": [
                {"id": f.id, "date": f.start_time, "duration_s": f.duration_s or 0}
                for f in fls
            ],
        })
    result.sort(key=lambda a: a["visits"], reverse=True)
    return result


def compute(track: dict) -> dict:
    """Compute flight statistics from an OpenSky /tracks/all payload.

    Path waypoint layout (OpenSky):
        [time, latitude, longitude, baro_altitude(m), true_track, on_ground]
    Velocity is not provided, so ground speed is derived per segment from
    distance / time between consecutive fixes.
    """
    path = track.get("path") or []
    start = track.get("startTime") or (path[0][0] if path else 0)
    end = track.get("endTime") or (path[-1][0] if path else 0)

    duration_s = max(0, int(end) - int(start))

    altitudes_ft = []
    distance_m = 0.0
    max_speed_kt = 0.0

    prev = None
    for wp in path:
        t, lat, lon, alt = wp[0], wp[1], wp[2], wp[3]

        if alt is not None:
            altitudes_ft.append(alt * M_TO_FT)

        if lat is not None and lon is not None:
            if prev is not None:
                seg_m = _haversine_m(prev[1], prev[2], lat, lon)
                distance_m += seg_m
                dt = (t or 0) - (prev[0] or 0)
                if dt > 0:
                    speed_kt = (seg_m / dt) * MS_TO_KT
                    # Guard against GPS jumps producing absurd speeds.
                    if speed_kt < 600:
                        max_speed_kt = max(max_speed_kt, speed_kt)
            prev = (t, lat, lon)

    distance_km = distance_m / 1000.0
    avg_speed_kt = ((distance_m / duration_s) * MS_TO_KT) if duration_s else 0.0

    return {
        "duration_s": duration_s,
        "distance_km": round(distance_km, 2),
        "max_altitude_ft": round(max(altitudes_ft), 1) if altitudes_ft else 0.0,
        "avg_altitude_ft": round(sum(altitudes_ft) / len(altitudes_ft), 1)
        if altitudes_ft
        else 0.0,
        "max_speed_kt": round(max_speed_kt, 1),
        "avg_speed_kt": round(avg_speed_kt, 1),
    }
