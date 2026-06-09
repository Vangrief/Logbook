"""Settings endpoints (app config + OpenSky credentials)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import SettingsOut, SettingsUpdate
from ..settings_store import get_value, set_value

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return SettingsOut(
        app_title=get_value(db, "app_title"),
        pilot_name=get_value(db, "pilot_name"),
        opensky_client_id=get_value(db, "opensky_client_id"),
        opensky_secret_set=bool(get_value(db, "opensky_client_secret")),
    )


@router.put("", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    if payload.app_title is not None:
        set_value(db, "app_title", payload.app_title.strip() or "Logbook")
    if payload.pilot_name is not None:
        set_value(db, "pilot_name", payload.pilot_name.strip())
    if payload.opensky_client_id is not None:
        set_value(db, "opensky_client_id", payload.opensky_client_id.strip())
    # Only overwrite the secret when a non-empty value is supplied so the UI
    # can submit settings without echoing the stored secret back.
    if payload.opensky_client_secret:
        set_value(db, "opensky_client_secret", payload.opensky_client_secret.strip())

    db.commit()
    return get_settings(db)
