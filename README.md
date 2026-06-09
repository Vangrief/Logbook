# Logbook

A self-hosted flight logbook that pulls real GPS tracks from the
[OpenSky Network](https://opensky-network.org/) and archives them locally with
an interactive map, altitude profile, and pilot notes. Built for a homelab
(Unraid) deployment.

**Stack:** Python / FastAPI · SQLite · Vanilla JS + Leaflet.js · Docker

---

## Features

- **Fetch by ICAO24 + a time during the flight.** OpenSky's `/tracks/all`
  endpoint resolves the *entire* flight from any single timestamp while the
  aircraft was airborne — no need to know exact start/end times.
- **Flight list** — sortable & filterable by date, aircraft, duration,
  distance, altitude, speed, with a pilot-notes preview per flight.
- **Flight detail** — full GPS track on a dark Leaflet map (CartoDB Dark
  Matter) drawn as a green → amber → red gradient (takeoff → landing), an
  altitude profile chart, computed stats, and an editable notes field.
- **Aircraft management** — registration, ICAO24 hex, model, optional
  nickname, and per-aircraft map track color.
- **OpenSky OAuth2** — client-credentials flow; tokens are cached and
  auto-refreshed (~30 min lifetime), with handling for 401 / 429.

---

## Quick start (Docker / Unraid)

1. Clone or copy this folder onto the server.
2. (Optional) seed credentials:
   ```bash
   cp .env.example .env
   # edit .env — or just set credentials later in the Settings page
   ```
3. Build & run:
   ```bash
   docker compose up -d --build
   ```
4. Open **http://10.0.10.90:7323**

The SQLite database is persisted to `/mnt/user/appdata/flightarchive` on the
Unraid host.

### First-run setup

On first launch the app seeds two aircraft (HB-EZD and HB-EZE, both
Bristell B23-912iS) with **blank ICAO24 hex** values. Then:

1. Go to **Settings** → fill in each aircraft's **ICAO24 hex**.
2. Under **OpenSky API Credentials**, paste your **Client ID** and
   **Client Secret** (create them at
   <https://opensky-network.org/> → Account → API Client).
3. Set the **App Title** and **Pilot Name** if you like.

### Logging a flight

**Log Flight** → choose the aircraft, enter the **date** and an
**approximate time (UTC) during the flight**, add optional notes, then
**Fetch & Save**. The app queries OpenSky, stores the raw track plus
computed stats, and opens the detail view.

> Times are entered and displayed in **UTC**.

---

## Local development (without Docker)

```bash
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 7323
```

The database falls back to `./flightarchive.db` when `/data` isn't mounted.
Visit <http://localhost:7323>.

---

## Project layout

```
app/
  main.py            FastAPI app, startup seeding, static serving
  database.py        SQLAlchemy engine / session
  models.py          Aircraft, Flight, Setting tables
  schemas.py         Pydantic request/response models
  opensky.py         OAuth2 token cache + /tracks/all client
  stats.py           Distance / altitude / speed computation
  settings_store.py  Key/value settings helpers
  seed.py            First-launch defaults
  routers/           aircraft, flights, settings endpoints
  static/            index.html, css, js (Leaflet + Chart.js via CDN)
Dockerfile
docker-compose.yml
.env.example
```

## API

| Method | Path                       | Purpose                              |
|--------|----------------------------|--------------------------------------|
| GET    | `/api/aircraft`            | List aircraft                        |
| POST   | `/api/aircraft`            | Add aircraft                         |
| PUT    | `/api/aircraft/{id}`       | Edit aircraft                        |
| DELETE | `/api/aircraft/{id}`       | Delete aircraft (and its flights)    |
| GET    | `/api/flights`             | List flights (`aircraft_id`,`sort`,`order`) |
| POST   | `/api/flights`             | Fetch from OpenSky + archive         |
| GET    | `/api/flights/{id}`        | Flight detail incl. track            |
| PUT    | `/api/flights/{id}/notes`  | Update pilot notes                   |
| DELETE | `/api/flights/{id}`        | Delete flight                        |
| GET/PUT| `/api/settings`            | App config + OpenSky credentials     |

Interactive docs available at `/docs` (FastAPI / Swagger UI).

---

## Notes & limitations

- OpenSky's free tier is rate-limited and historical coverage depends on
  receiver availability — some flights (especially low-altitude GA) may have
  partial or missing tracks.
- Ground speed is derived from consecutive GPS fixes (OpenSky tracks don't
  carry velocity); brief GPS jumps are filtered out of the max-speed stat.
- Altitudes are barometric, converted to feet for display.
