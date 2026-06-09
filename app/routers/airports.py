"""Airports map endpoint — unique visited airfields derived from track data."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Flight
from ..stats import cluster_airports

router = APIRouter(prefix="/api/airports", tags=["airports"])


@router.get("")
def get_airports(db: Session = Depends(get_db)):
    flights = list(db.scalars(select(Flight)))
    airports = cluster_airports(flights)
    return {
        "total_airports": len(airports),
        "total_flights": len(flights),
        "airports": airports,
    }
