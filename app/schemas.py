"""Pydantic request/response schemas."""
from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# Aircraft
# ---------------------------------------------------------------------------
class AircraftBase(BaseModel):
    registration: str
    icao24: str
    model: str = ""
    nickname: str | None = None
    color: str | None = None


class AircraftCreate(AircraftBase):
    pass


class AircraftUpdate(BaseModel):
    registration: str | None = None
    icao24: str | None = None
    model: str | None = None
    nickname: str | None = None
    color: str | None = None


class AircraftOut(AircraftBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------------------------------------------------------------------------
# Flights
# ---------------------------------------------------------------------------
class FlightCreate(BaseModel):
    aircraft_id: int
    # Unix timestamp (seconds, UTC) sometime DURING the flight.
    time: int
    notes: str = ""
    # Mark the flight as ongoing so the detail page enters live mode.
    live: bool = False


class FlightNotesUpdate(BaseModel):
    notes: str


class FlightPatch(BaseModel):
    """Incremental update used by live tracking."""

    # A single new track point: [time, lat, lon, baro_alt_m, heading, on_ground]
    append_point: list | None = None
    end_time: int | None = None
    # When true, re-fetch the full track from OpenSky and close the flight out.
    finalize: bool = False


class DiscoveredFlight(BaseModel):
    """A flight returned by OpenSky's /flights/aircraft discovery query."""

    icao24: str
    first_seen: int
    last_seen: int
    duration_s: int
    callsign: str | None = None
    est_departure_airport: str | None = None
    est_arrival_airport: str | None = None
    # Whether this flight is already stored locally, and its id if so.
    already_logged: bool = False
    logged_flight_id: int | None = None
    # Ongoing flight (no arrival time yet) — offer "Track Live".
    live: bool = False
    # Where this candidate came from: historical / live / tracks.
    source: str = "historical"


class FlightSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    aircraft_id: int
    callsign: str | None
    start_time: int
    end_time: int
    duration_s: int
    distance_km: float
    max_altitude_ft: float
    avg_altitude_ft: float
    max_speed_kt: float
    avg_speed_kt: float
    notes: str
    is_live: bool = False

    # Joined aircraft fields, populated in the router.
    registration: str | None = None
    aircraft_model: str | None = None
    nickname: str | None = None
    color: str | None = None
    icao24: str | None = None


class FlightDetail(FlightSummary):
    query_time: int
    # Decoded track: list of [time, lat, lon, baro_alt_m, true_track, on_ground]
    track: list = []


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class SettingsOut(BaseModel):
    app_title: str = "Logbook"
    pilot_name: str = ""
    opensky_client_id: str = ""
    # Never return the actual secret; only whether one is configured.
    opensky_secret_set: bool = False


class SettingsUpdate(BaseModel):
    app_title: str | None = None
    pilot_name: str | None = None
    opensky_client_id: str | None = None
    opensky_client_secret: str | None = None
