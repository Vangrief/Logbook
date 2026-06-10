"""FastAPI application entry point for Logbook."""
import logging
import os

from fastapi import FastAPI, Request

# Ensure application INFO logs reach stdout/stderr (visible in `docker logs`).
# Uvicorn configures its own loggers but leaves the root logger untouched, so
# without this our getLogger("logbook.*") INFO messages would be dropped.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .database import Base, SessionLocal, engine
from .routers import (
    airports,
    aircraft,
    auth as auth_router,
    flights,
    heatmap,
    live,
    settings,
    stats,
)
from .seed import seed

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
LOGIN_PAGE = os.path.join(STATIC_DIR, "login.html")
INDEX_PAGE = os.path.join(STATIC_DIR, "index.html")

# Prevent the browser from caching the HTML shells. The login page and the SPA
# live at different URLs (/login vs /), so they can never be confused, but
# no-store also stops a stale shell from triggering a redirect loop.
NO_STORE = {"Cache-Control": "no-store, must-revalidate"}

# Paths reachable without a valid session: the login flow, health check and
# static assets (the login page needs its stylesheet/fonts).
PUBLIC_PREFIXES = ("/static",)
PUBLIC_PATHS = {
    "/login",
    "/api/login",
    "/api/logout",
    "/api/health",
    "/sw.js",
    "/manifest.json",
}

app = FastAPI(title="Logbook", version="1.0.0")


def _migrate(conn) -> None:
    """Lightweight additive migrations for existing SQLite databases."""
    cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(flights)")]
    if "is_live" not in cols:
        conn.exec_driver_sql(
            "ALTER TABLE flights ADD COLUMN is_live BOOLEAN NOT NULL DEFAULT 0"
        )


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        _migrate(conn)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


@app.middleware("http")
async def require_auth(request: Request, call_next):
    """Gate every request behind the shared password.

    Unauthenticated API calls get a 401; unauthenticated page loads are
    redirected to the dedicated /login page. Static assets and the login
    endpoints stay public.
    """
    path = request.url.path
    is_public = path in PUBLIC_PATHS or any(
        path.startswith(p) for p in PUBLIC_PREFIXES
    )
    if is_public or auth.is_authenticated(request):
        return await call_next(request)

    if path.startswith("/api"):
        return JSONResponse(
            {"detail": "Authentication required"}, status_code=401
        )
    return RedirectResponse("/login", status_code=302)


app.include_router(auth_router.router)
app.include_router(aircraft.router)
app.include_router(flights.router)
app.include_router(settings.router)
app.include_router(stats.router)
app.include_router(airports.router)
app.include_router(heatmap.router)
app.include_router(live.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve the SPA. Static assets live under /static; every other path returns
# index.html so client-side hash routing works on hard refresh.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/sw.js")
def service_worker():
    # Served from root so the worker gets root scope (not /static).
    return FileResponse(
        os.path.join(STATIC_DIR, "sw.js"),
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )


@app.get("/manifest.json")
def manifest():
    return FileResponse(
        os.path.join(STATIC_DIR, "manifest.json"),
        media_type="application/manifest+json",
    )


@app.get("/login")
def login_page():
    # Always the login page, on its own URL so it never shares a cache entry
    # with the SPA shell at "/".
    return FileResponse(LOGIN_PAGE, headers=NO_STORE)


@app.get("/")
def index():
    return FileResponse(INDEX_PAGE, headers=NO_STORE)
