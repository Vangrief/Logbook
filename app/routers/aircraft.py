"""Aircraft CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Aircraft
from ..schemas import AircraftCreate, AircraftOut, AircraftUpdate

router = APIRouter(prefix="/api/aircraft", tags=["aircraft"])


def _normalise_icao(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip().lower()


@router.get("", response_model=list[AircraftOut])
def list_aircraft(db: Session = Depends(get_db)):
    return list(db.scalars(select(Aircraft).order_by(Aircraft.registration)))


@router.post("", response_model=AircraftOut, status_code=201)
def create_aircraft(payload: AircraftCreate, db: Session = Depends(get_db)):
    aircraft = Aircraft(
        registration=payload.registration.strip().upper(),
        icao24=_normalise_icao(payload.icao24) or "",
        model=payload.model.strip(),
        nickname=(payload.nickname or "").strip() or None,
        color=(payload.color or "").strip() or None,
    )
    db.add(aircraft)
    db.commit()
    db.refresh(aircraft)
    return aircraft


@router.put("/{aircraft_id}", response_model=AircraftOut)
def update_aircraft(
    aircraft_id: int, payload: AircraftUpdate, db: Session = Depends(get_db)
):
    aircraft = db.get(Aircraft, aircraft_id)
    if aircraft is None:
        raise HTTPException(status_code=404, detail="Aircraft not found")

    if payload.registration is not None:
        aircraft.registration = payload.registration.strip().upper()
    if payload.icao24 is not None:
        aircraft.icao24 = _normalise_icao(payload.icao24) or ""
    if payload.model is not None:
        aircraft.model = payload.model.strip()
    if payload.nickname is not None:
        aircraft.nickname = payload.nickname.strip() or None
    if payload.color is not None:
        aircraft.color = payload.color.strip() or None

    db.commit()
    db.refresh(aircraft)
    return aircraft


@router.delete("/{aircraft_id}", status_code=204)
def delete_aircraft(aircraft_id: int, db: Session = Depends(get_db)):
    aircraft = db.get(Aircraft, aircraft_id)
    if aircraft is None:
        raise HTTPException(status_code=404, detail="Aircraft not found")
    db.delete(aircraft)
    db.commit()
