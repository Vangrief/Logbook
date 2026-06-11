"""OpenSky Network API client with OAuth2 client-credentials handling.

Tokens are cached in-process and refreshed automatically a minute before
expiry (OpenSky tokens live ~30 minutes). A single retry with a forced
token refresh is performed on a 401 in case the cached token went stale.
"""
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


# In-memory cache for /flights/aircraft responses: (icao24, begin, end) ->
# (fetched_at, data). Re-running discovery with the same inputs within the TTL
# costs no OpenSky API call.
FLIGHTS_CACHE_TTL_S = 300
_flights_cache: dict[tuple[str, int, int], tuple[float, list]] = {}


async def fetch_flights(
    icao24: str, begin: int, end: int, client_id: str, client_secret: str
) -> list[dict]:
    """List all flights of `icao24` between `begin` and `end` (unix seconds).

    Uses OpenSky's /flights/aircraft endpoint. A 404 / empty body means there
    are simply no flights in that window, which is returned as an empty list
    (not an error) so the UI can show a friendly "no flights" message.
    Successful results are cached in memory for 5 minutes.
    """
    icao24 = icao24.strip().lower()

    if not client_id or not client_secret:
        raise OpenSkyError(
            "OpenSky API credentials are not configured. Add them in Settings.",
            400,
        )

    # Purge expired entries, then serve from cache when possible.
    now = time.time()
    for key in [k for k, (ts, _) in _flights_cache.items()
                if now - ts > FLIGHTS_CACHE_TTL_S]:
        del _flights_cache[key]
    cache_key = (icao24, begin, end)
    if cache_key in _flights_cache:
        data = _flights_cache[cache_key][1]
        logger.info(
            "OpenSky flights/aircraft cache hit icao24=%s returned=%d flight(s)",
            icao24, len(data),
        )
        return data

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
        _flights_cache[cache_key] = (time.time(), [])
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
        _flights_cache[cache_key] = (time.time(), [])
        return []

    data = resp.json() or []
    logger.info(
        "OpenSky flights/aircraft 200 icao24=%s returned=%d flight(s)",
        icao24, len(data),
    )
    _flights_cache[cache_key] = (time.time(), data)
    return data
