"""Live state-vector endpoint for in-progress flight tracking."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import opensky
from ..database import get_db
from ..settings_store import get_credentials

router = APIRouter(prefix="/api/live", tags=["live"])


@router.get("/{icao24}")
async def live_state(icao24: str, db: Session = Depends(get_db)):
    """Return the current state vector for `icao24`, or 204 if unavailable/stale."""
    client_id, client_secret = get_credentials(db)
    try:
        state = await opensky.fetch_state(icao24, client_id, client_secret)
    except opensky.OpenSkyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    if state is None:
        return Response(status_code=204)
    return state
