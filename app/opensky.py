"""OpenSky Network API client with OAuth2 client-credentials handling.

Tokens are cached in-process and refreshed automatically a minute before
expiry (OpenSky tokens live ~30 minutes). A single retry with a forced
token refresh is performed on a 401 in case the cached token went stale.
"""
import asyncio
import logging
import time

import httpx

logger = logging.getLogger("logbook.opensky")

TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/"
    "protocol/openid-connect/token"
)
API_BASE = "https://opensky-network.org/api"


class OpenSkyError(Exception):
    """Raised for any non-recoverable OpenSky API failure."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class _TokenCache:
    token: str | None = None
    expires_at: float = 0.0
    # Track which credentials the cached token belongs to so changing the
    # client_id in settings invalidates the cache.
    client_id: str | None = None


_cache = _TokenCache()


async def _get_token(client_id: str, client_secret: str, force: bool = False) -> str:
    now = time.time()
    if (
        not force
        and _cache.token
        and _cache.client_id == client_id
        and now < _cache.expires_at - 60
    ):
        return _cache.token

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.RequestError as exc:
            raise OpenSkyError(f"Could not reach OpenSky auth server: {exc}") from exc

    if resp.status_code == 401:
        raise OpenSkyError("OpenSky rejected the client credentials (401).", 401)
    if resp.status_code != 200:
        raise OpenSkyError(
            f"OpenSky token request failed ({resp.status_code}).", 502
        )

    data = resp.json()
    _cache.token = data["access_token"]
    _cache.expires_at = now + int(data.get("expires_in", 1800))
    _cache.client_id = client_id
    return _cache.token


async def fetch_track(
    icao24: str, time_ts: int, client_id: str, client_secret: str
) -> dict:
    """Fetch the full flight track that contains `time_ts` for `icao24`.

    OpenSky resolves the entire flight from any timestamp during it via
    /tracks/all (time=0 would mean "live", so we always pass the real time).
    """
    icao24 = icao24.strip().lower()

    if not client_id or not client_secret:
        raise OpenSkyError(
            "OpenSky API credentials are not configured. Add them in Settings.",
            400,
        )

    async def _do_request(token: str) -> httpx.Response:
        async with httpx.AsyncClient(timeout=45.0) as client:
            return await client.get(
                f"{API_BASE}/tracks/all",
                params={"icao24": icao24, "time": time_ts},
                headers={"Authorization": f"Bearer {token}"},
            )

    token = await _get_token(client_id, client_secret)
    try:
        resp = await _do_request(token)
        if resp.status_code == 401:
            # Token may be stale — refresh once and retry.
            token = await _get_token(client_id, client_secret, force=True)
            resp = await _do_request(token)
    except httpx.RequestError as exc:
        raise OpenSkyError(f"Could not reach OpenSky API: {exc}") from exc

    if resp.status_code == 401:
        raise OpenSkyError("OpenSky authentication failed (401).", 401)
    if resp.status_code == 429:
        raise OpenSkyError(
            "OpenSky rate limit reached (429). Please wait and try again.", 429
        )
    if resp.status_code == 404:
        raise OpenSkyError(
            "No flight found for that aircraft and time. Check the ICAO24 hex "
            "and that the timestamp falls during the flight.",
            404,
        )
    if resp.status_code != 200:
        raise OpenSkyError(f"OpenSky API error ({resp.status_code}).", 502)

    # An empty body means OpenSky has no track for that query.
    if not resp.text or not resp.text.strip():
        raise OpenSkyError(
            "OpenSky returned no track for that aircraft and time.", 404
        )

    data = resp.json()
    if not data or not data.get("path"):
        raise OpenSkyError(
            "OpenSky returned an empty track for that aircraft and time.", 404
        )
    return data


async def fetch_flights(
    icao24: str, begin: int, end: int, client_id: str, client_secret: str
) -> list[dict]:
    """List all flights of `icao24` between `begin` and `end` (unix seconds).

    Uses OpenSky's /flights/aircraft endpoint. A 404 / empty body means there
    are simply no flights in that window, which is returned as an empty list
    (not an error) so the UI can show a friendly "no flights" message.
    """
    icao24 = icao24.strip().lower()

    if not client_id or not client_secret:
        raise OpenSkyError(
            "OpenSky API credentials are not configured. Add them in Settings.",
            400,
        )

    url = f"{API_BASE}/flights/aircraft"
    # Log the exact request (icao24 is lowercased, as OpenSky requires).
    logger.info(
        "OpenSky GET %s?icao24=%s&begin=%d&end=%d", url, icao24, begin, end
    )

    async def _do_request(token: str) -> httpx.Response:
        async with httpx.AsyncClient(timeout=45.0) as client:
            return await client.get(
                url,
                params={"icao24": icao24, "begin": begin, "end": end},
                headers={"Authorization": f"Bearer {token}"},
            )

    token = await _get_token(client_id, client_secret)
    try:
        resp = await _do_request(token)
        if resp.status_code == 401:
            # Token may be stale — refresh once and retry.
            token = await _get_token(client_id, client_secret, force=True)
            resp = await _do_request(token)
    except httpx.RequestError as exc:
        raise OpenSkyError(f"Could not reach OpenSky API: {exc}") from exc

    if resp.status_code == 401:
        raise OpenSkyError("OpenSky authentication failed (401).", 401)
    if resp.status_code == 429:
        raise OpenSkyError(
            "OpenSky rate limit reached (429). Please wait and try again.", 429
        )
    # 404 / empty simply means no flights in the requested window.
    if resp.status_code == 404:
        logger.info("OpenSky flights/aircraft 404 (no flights) icao24=%s", icao24)
        return []
    if resp.status_code != 200:
        # Surface (don't silently swallow) the unexpected body for diagnosis.
        logger.warning(
            "OpenSky flights/aircraft unexpected status %d icao24=%s body=%r",
            resp.status_code, icao24, resp.text[:300],
        )
        raise OpenSkyError(f"OpenSky API error ({resp.status_code}).", 502)

    if not resp.text or not resp.text.strip():
        logger.info("OpenSky flights/aircraft 200 (empty body) icao24=%s", icao24)
        return []

    data = resp.json() or []
    logger.info(
        "OpenSky flights/aircraft 200 icao24=%s returned=%d flight(s)",
        icao24, len(data),
    )
    return data


async def fetch_state(
    icao24: str, client_id: str, client_secret: str, max_age_s: int = 60
) -> dict | None:
    """Current state vector for `icao24` via /states/all.

    Returns a normalised dict (lat/lon/altitude_m/velocity_mps/heading/
    on_ground/last_contact) or None when the aircraft is not found or the data
    is stale (last contact older than `max_age_s`).
    """
    icao24 = icao24.strip().lower()

    if not client_id or not client_secret:
        raise OpenSkyError(
            "OpenSky API credentials are not configured. Add them in Settings.",
            400,
        )

    async def _do_request(token: str) -> httpx.Response:
        async with httpx.AsyncClient(timeout=20.0) as client:
            return await client.get(
                f"{API_BASE}/states/all",
                params={"icao24": icao24},
                headers={"Authorization": f"Bearer {token}"},
            )

    token = await _get_token(client_id, client_secret)
    try:
        resp = await _do_request(token)
        if resp.status_code == 401:
            token = await _get_token(client_id, client_secret, force=True)
            resp = await _do_request(token)
    except httpx.RequestError as exc:
        raise OpenSkyError(f"Could not reach OpenSky API: {exc}") from exc

    if resp.status_code == 401:
        raise OpenSkyError("OpenSky authentication failed (401).", 401)
    if resp.status_code == 429:
        raise OpenSkyError(
            "OpenSky rate limit reached (429). Please wait and try again.", 429
        )
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise OpenSkyError(f"OpenSky API error ({resp.status_code}).", 502)
    if not resp.text or not resp.text.strip():
        return None

    data = resp.json()
    states = data.get("states") or []
    if not states:
        return None

    # State vector layout (OpenSky /states/all):
    # 0 icao24, 4 last_contact, 5 lon, 6 lat, 7 baro_alt, 8 on_ground,
    # 9 velocity, 10 true_track, 13 geo_alt
    row = states[0]
    last_contact = row[4]
    lat, lon = row[6], row[5]
    if last_contact is None or lat is None or lon is None:
        return None

    server_time = data.get("time") or int(time.time())
    if server_time - last_contact > max_age_s:
        return None  # stale

    return {
        "lat": lat,
        "lon": lon,
        "altitude_m": row[7] if row[7] is not None else row[13],
        "velocity_mps": row[9],
        "heading": row[10],
        "on_ground": bool(row[8]),
        "last_contact": int(last_contact),
    }


async def fetch_tracks_for_window(
    icao24: str, times: list[int], client_id: str, client_secret: str
) -> list[dict]:
    """Probe /tracks/all at each timestamp in `times` and return the distinct
    tracks found.

    Used to surface "limbo" flights that the historical /flights/aircraft
    endpoint hasn't published yet. Each probe is best-effort: a 404 / empty /
    rate-limited slot simply yields nothing. Results are de-duplicated against
    each other by start time (±600 s); the caller is responsible for de-duping
    them against the historical flight list.
    """
    icao24 = icao24.strip().lower()
    if not times:
        return []
    if not client_id or not client_secret:
        return []

    async def _one(ts: int):
        try:
            return await fetch_track(icao24, ts, client_id, client_secret)
        except OpenSkyError:
            return None  # no track / 404 / rate-limited at this slot

    probed = await asyncio.gather(*[_one(ts) for ts in times])

    tracks: list[dict] = []
    seen_starts: list[int] = []
    for tr in probed:
        path = (tr or {}).get("path") or []
        if not path:
            continue
        start = int(tr.get("startTime") or path[0][0])
        if any(abs(start - s) <= 600 for s in seen_starts):
            continue
        seen_starts.append(start)
        tracks.append(tr)

    logger.info(
        "OpenSky tracks/all window probe icao24=%s slots=%d found=%d distinct track(s)",
        icao24, len(times), len(tracks),
    )
    return tracks
