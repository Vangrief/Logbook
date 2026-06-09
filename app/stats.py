"""Track statistics: distance, altitude and speed derived from a track."""
import math

M_TO_FT = 3.28084
MS_TO_KT = 1.94384


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
