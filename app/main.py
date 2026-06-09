"""FastAPI application entry point for the Flight Archive."""
import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .database import Base, SessionLocal, engine
from .routers import aircraft, flights, settings
from .seed import seed

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

app = FastAPI(title="Flight Archive", version="1.0.0")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


app.include_router(aircraft.router)
app.include_router(flights.router)
app.include_router(settings.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve the SPA. Static assets live under /static; every other path returns
# index.html so client-side hash routing works on hard refresh.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
