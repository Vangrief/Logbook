"""FastAPI application entry point for Logbook."""
import os

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .database import Base, SessionLocal, engine
from .routers import aircraft, auth as auth_router, flights, settings
from .seed import seed

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
LOGIN_PAGE = os.path.join(STATIC_DIR, "login.html")

# Paths reachable without a valid session: the login flow, health check and
# static assets (the login page needs its stylesheet/fonts).
PUBLIC_PREFIXES = ("/static",)
PUBLIC_PATHS = {"/api/login", "/api/logout", "/api/health"}

app = FastAPI(title="Logbook", version="1.0.0")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


@app.middleware("http")
async def require_auth(request: Request, call_next):
    """Gate every request behind the shared password.

    Unauthenticated API calls get a 401; unauthenticated page loads get the
    login page. Static assets and the login endpoints stay public.
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
    return FileResponse(LOGIN_PAGE)


app.include_router(auth_router.router)
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
