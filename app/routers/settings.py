"""Settings endpoints (app config + OpenSky credentials + Cesium token)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import CesiumToken, SettingsOut, SettingsUpdate
from ..settings_store import get_value, set_value

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _mask(token: str) -> str:
    """First 8 chars + ellipsis for display; empty when unset."""
    token = token or ""
    if not token:
        return ""
    return token[:8] + "…" if len(token) > 8 else token + "…"


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    cesium = get_value(db, "cesium_token")
    return SettingsOut(
        app_title=get_value(db, "app_title"),
        pilot_name=get_value(db, "pilot_name"),
        opensky_client_id=get_value(db, "opensky_client_id"),
        opensky_secret_set=bool(get_value(db, "opensky_client_secret")),
        cesium_token_set=bool(cesium),
        cesium_token_masked=_mask(cesium),
    )


@router.get("/cesium-token", response_model=CesiumToken)
def get_cesium_token(db: Session = Depends(get_db)):
    # Cesium Ion tokens are client-side tokens, so the 3D viewer reads the full
    # value (unlike the OpenSky secret).
    return CesiumToken(token=get_value(db, "cesium_token"))


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
    if payload.cesium_token is not None:
        set_value(db, "cesium_token", payload.cesium_token.strip())

    db.commit()
    return get_settings(db)
