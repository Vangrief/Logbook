"""Historical weather lookup via the Open-Meteo archive API (no key needed)."""
import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger("logbook.weather")

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
ZRH = ZoneInfo("Europe/Zurich")

HOURLY_VARS = (
    "temperature_2m,windspeed_10m,winddirection_10m,weathercode,"
    "visibility,precipitation,cloudcover"
)

# WMO weather interpretation codes (0-99) → plain English.
WMO_CODES = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def describe(code: int) -> str:
    return WMO_CODES.get(code, "Unknown")


async def fetch_weather(lat: float, lon: float, departure_ts: int) -> dict | None:
    """Fetch the hourly weather closest to `departure_ts` at (lat, lon).

    Returns a WeatherData-shaped dict, or None if Open-Meteo has no usable data
    (e.g. archive lag for very recent flights, or a network/API error).
    """
    dep_local = datetime.fromtimestamp(departure_ts, ZRH)
    date_str = dep_local.strftime("%Y-%m-%d")

    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": date_str,
        "end_date": date_str,
        "hourly": HOURLY_VARS,
        "timezone": "Europe/Zurich",
        "windspeed_unit": "kn",  # knots — pilot-friendly
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(ARCHIVE_URL, params=params)
    except httpx.RequestError as exc:
        logger.warning("Open-Meteo request failed: %s", exc)
        return None

    if resp.status_code != 200:
        logger.warning(
            "Open-Meteo returned %d body=%r", resp.status_code, resp.text[:200]
        )
        return None

    hourly = (resp.json() or {}).get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        return None

    # Closest hourly slot to the departure time.
    best_i, best_diff = None, None
    for i, ts_str in enumerate(times):
        try:
            slot_ts = int(datetime.fromisoformat(ts_str).replace(tzinfo=ZRH).timestamp())
        except ValueError:
            continue
        diff = abs(slot_ts - departure_ts)
        if best_diff is None or diff < best_diff:
            best_i, best_diff = i, diff
    if best_i is None:
        return None

    def at(key):
        arr = hourly.get(key) or []
        return arr[best_i] if best_i < len(arr) else None

    raw_code = at("weathercode")
    code = int(raw_code) if raw_code is not None else -1
    temp = at("temperature_2m")
    wind = at("windspeed_10m")
    wdir = at("winddirection_10m")
    vis = at("visibility")
    precip = at("precipitation")
    cloud = at("cloudcover")

    # If the core readings are all missing, treat as no data.
    if temp is None and wind is None and code == -1:
        return None

    slot_local = datetime.fromisoformat(times[best_i]).replace(tzinfo=ZRH)
    slot_utc = slot_local.astimezone(timezone.utc)

    return {
        "temperature_c": float(temp) if temp is not None else None,
        "windspeed_kt": float(wind) if wind is not None else None,
        "wind_direction_deg": int(wdir) if wdir is not None else None,
        "weathercode": code,
        "weather_description": describe(code),
        "visibility_m": float(vis) if vis is not None else None,
        "precipitation_mm": float(precip) if precip is not None else None,
        "cloudcover_pct": int(cloud) if cloud is not None else None,
        "data_time_utc": slot_utc.strftime("%Y-%m-%dT%H:%MZ"),
    }
