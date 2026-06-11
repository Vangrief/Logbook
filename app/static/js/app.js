/* ============================================================
   Logbook — SPA router + views (vanilla JS)
   ============================================================ */
const view = document.getElementById("view");

// Cache of aircraft for the current session (refreshed where needed).
let aircraftCache = [];

/* ---------------- Routing ---------------- */
const routes = [
  { re: /^#\/flights\/(\d+)$/, handler: (m) => renderDetail(Number(m[1])) },
  { re: /^#\/flights$/, handler: renderFlights },
  { re: /^#\/new$/, handler: renderNew },
  { re: /^#\/stats$/, handler: renderStats },
  { re: /^#\/airports$/, handler: renderAirports },
  { re: /^#\/heatmap$/, handler: renderHeatmap },
  { re: /^#\/settings$/, handler: renderSettings },
];

function router() {
  const hash = window.location.hash || "#/flights";
  cesium3d.cleanup();
  setActiveNav(hash);
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) return r.handler(m);
  }
  window.location.hash = "#/flights";
}

function setActiveNav(hash) {
  const key = hash.startsWith("#/new")
    ? "new"
    : hash.startsWith("#/stats")
    ? "stats"
    : hash.startsWith("#/airports")
    ? "airports"
    : hash.startsWith("#/heatmap")
    ? "heatmap"
    : hash.startsWith("#/settings")
    ? "settings"
    : "flights";
  // Covers both the desktop nav and the mobile menu links.
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === key)
  );
}

window.addEventListener("hashchange", router);

/* ---------------- App header / branding ---------------- */
async function loadBranding() {
  try {
    const s = await API.getSettings();
    document.getElementById("brand-title").textContent = s.app_title || "Logbook";
    document.title = s.app_title || "Logbook";
    document.getElementById("pilot-name").textContent = s.pilot_name
      ? `PIC · ${s.pilot_name}`
      : "";
  } catch (_) { /* ignore on first boot */ }
}

async function ensureAircraft() {
  aircraftCache = await API.listAircraft();
  return aircraftCache;
}

function loading(label = "Loading") {
  view.innerHTML = `<div class="empty"><span class="spinner"></span>
    <div style="margin-top:14px">${U.esc(label)}…</div></div>`;
}

/* ============================================================
   FLIGHT LIST
   ============================================================ */
let listState = { aircraft_id: "", sort: "date", order: "desc" };

async function renderFlights() {
  loading("Loading flights");
  try {
    await ensureAircraft();
    const flights = await API.listFlights({
      aircraft_id: listState.aircraft_id,
      sort: listState.sort,
      order: listState.order,
    });
    drawFlights(flights);
  } catch (e) {
    view.innerHTML = errorBox(e.message);
  }
}

function drawFlights(flights) {
  const acOptions = [`<option value="">All aircraft</option>`]
    .concat(
      aircraftCache.map(
        (a) =>
          `<option value="${a.id}" ${
            String(a.id) === String(listState.aircraft_id) ? "selected" : ""
          }>${U.esc(a.registration)}${a.nickname ? " · " + U.esc(a.nickname) : ""}</option>`
      )
    )
    .join("");

  const sortOptions = [
    ["date", "Date"],
    ["duration", "Duration"],
    ["distance", "Distance"],
    ["altitude", "Max altitude"],
    ["speed", "Max speed"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${v === listState.sort ? "selected" : ""}>${l}</option>`
    )
    .join("");

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Flight Log</h1>
        <div class="sub">${flights.length} flight${flights.length === 1 ? "" : "s"} archived</div>
      </div>
      <a class="btn btn-primary" href="#/new">＋ Log Flight</a>
    </div>

    <div class="toolbar">
      <div class="field-inline">
        <label>Aircraft</label>
        <select id="f-aircraft">${acOptions}</select>
      </div>
      <div class="field-inline">
        <label>Sort by</label>
        <select id="f-sort">${sortOptions}</select>
      </div>
      <div class="field-inline" style="min-width:120px">
        <label>Order</label>
        <select id="f-order">
          <option value="desc" ${listState.order === "desc" ? "selected" : ""}>Descending</option>
          <option value="asc" ${listState.order === "asc" ? "selected" : ""}>Ascending</option>
        </select>
      </div>
    </div>

    <div class="flight-list" id="flight-list"></div>
  `;

  const listEl = document.getElementById("flight-list");
  if (flights.length === 0) {
    listEl.innerHTML = `<div class="empty">
      <div class="big">✈</div>
      <div>No flights yet.</div>
      <div class="muted" style="margin-top:6px">Log your first flight to populate the archive.</div>
    </div>`;
  } else {
    drawFlightGroups(listEl, flights);
  }

  const reload = () => {
    listState.aircraft_id = document.getElementById("f-aircraft").value;
    listState.sort = document.getElementById("f-sort").value;
    listState.order = document.getElementById("f-order").value;
    renderFlights();
  };
  document.getElementById("f-aircraft").onchange = reload;
  document.getElementById("f-sort").onchange = reload;
  document.getElementById("f-order").onchange = reload;
}

// Group flights into Europe/Zurich calendar days (preserving the current
// sort order) and render a subtle date header + connector for flights that
// are part of the same session (<4 h between landing and next takeoff).
function drawFlightGroups(listEl, flights) {
  const SESSION_GAP_S = 4 * 3600;

  const groups = [];
  let current = null;
  for (const f of flights) {
    const key = U.zurichDateKey(f.start_time);
    if (!current || current.key !== key) {
      current = { key, ts: f.start_time, flights: [] };
      groups.push(current);
    }
    current.flights.push(f);
  }

  groups.forEach((g) => {
    const total = g.flights.reduce((s, f) => s + (f.duration_s || 0), 0);
    const n = g.flights.length;

    const groupEl = U.html(`
      <section class="day-group">
        <div class="day-header">
          <span class="d-date">${U.esc(U.zurichDateLabel(g.ts))}</span>
          <span class="d-meta">${n} flight${n === 1 ? "" : "s"} · ${U.fmtDuration(total)}</span>
        </div>
        <div class="day-rows"></div>
      </section>
    `);
    const rowsEl = groupEl.querySelector(".day-rows");

    g.flights.forEach((f, i) => {
      const row = flightRow(f);
      if (i > 0) {
        // Connect to the adjacent flight if the ground time between them
        // is under the session threshold (direction-agnostic).
        const prev = g.flights[i - 1];
        const earlier = f.start_time <= prev.start_time ? f : prev;
        const later = f.start_time <= prev.start_time ? prev : f;
        if (later.start_time - earlier.end_time < SESSION_GAP_S) {
          row.classList.add("linked");
        }
      }
      rowsEl.appendChild(row);
    });

    listEl.appendChild(groupEl);
  });
}

function flightRow(f) {
  const color = f.color || "#f4a7b9";
  const title = f.nickname || f.registration || "Unknown";
  const notes = f.notes ? U.esc(f.notes) : `<span class="muted">No notes</span>`;
  const row = U.html(`
    <div class="card flight-row">
      <div class="tail">
        <span class="dot" style="color:${U.esc(color)};background:${U.esc(color)}"></span>
        <span>${U.esc(f.registration || "—")}</span>
      </div>
      <div class="meta">
        <div class="date">${U.fmtDate(f.start_time)} · ${U.fmtZoned(f.start_time, "Europe/Zurich")}–${U.fmtZoned(f.end_time, "Europe/Zurich")}<span class="z">ZRH</span>
          ${f.callsign ? `· <span class="cs">${U.esc(f.callsign)}</span>` : ""}</div>
        <div class="notes">${notes}</div>
        <div class="model">${U.esc(f.aircraft_model || "")}</div>
      </div>
      <div class="stat-cell"><div class="v">${U.fmtDuration(f.duration_s)}</div><div class="u">dur</div></div>
      <div class="stat-cell"><div class="v">${U.num(f.distance_km, 1)}</div><div class="u">km</div></div>
      <div class="stat-cell"><div class="v">${U.num(f.max_altitude_ft)}</div><div class="u">ft max</div></div>
      <div class="stat-cell"><div class="v">${U.num(f.max_speed_kt)}</div><div class="u">kt max</div></div>
      <div class="chev">›</div>
    </div>
  `);
  row.onclick = () => { window.location.hash = `#/flights/${f.id}`; };
  return row;
}

/* ============================================================
   FLIGHT DETAIL
   ============================================================ */
async function renderDetail(id) {
  loading("Loading flight");
  let f;
  try {
    f = await API.getFlight(id);
  } catch (e) {
    view.innerHTML = errorBox(e.message);
    return;
  }

  const title = f.nickname || f.registration || "Flight";
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${U.esc(f.registration || "Flight")} <span class="muted" style="font-weight:400">${
          f.callsign ? "· " + U.esc(f.callsign) : ""
        }</span></h1>
        <div class="sub">${U.fmtDateTime(f.start_time)} → ${U.fmtTime(f.end_time)} · ${U.esc(
          f.aircraft_model || ""
        )}</div>
      </div>
      <div class="flex">
        <a class="btn btn-ghost" href="#/flights">‹ Back</a>
        <button class="btn" id="threed-btn">🌐 3D</button>
        <button class="btn" id="replay-btn">▶ Replay</button>
        <button class="btn btn-danger" id="del-flight">Delete</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="map-wrap">
        <div id="map"></div>
        <div id="cesium-container" class="cesium-container" hidden></div>
        <div id="cesium-overlays" class="cesium-overlays" hidden></div>

        <div class="replay-stats" id="replay-stats" hidden>
          <div class="rs-item"><span class="rs-l">ALT</span><span class="rs-v" id="rs-alt">—</span></div>
          <div class="rs-item"><span class="rs-l">SPD</span><span class="rs-v" id="rs-spd">—</span></div>
          <div class="rs-item"><span class="rs-l">HDG</span><span class="rs-v" id="rs-hdg">—</span></div>
          <div class="rs-item"><span class="rs-l">TIME</span><span class="rs-v" id="rs-time">—</span></div>
        </div>

        <div class="replay-bar" id="replay-bar" hidden>
          <button class="rp-btn" id="rp-restart" title="Restart" aria-label="Restart">◀◀</button>
          <button class="rp-btn" id="rp-play" title="Pause" aria-label="Pause">⏸</button>
          <input type="range" class="rp-scrub" id="rp-scrub" min="0" max="1000" value="0" aria-label="Seek" />
          <span class="rp-time" id="rp-time">00:00:00 / 00:00:00</span>
          <select class="rp-speed" id="rp-speed" aria-label="Playback speed">
            <option value="10">10×</option>
            <option value="50" selected>50×</option>
            <option value="100">100×</option>
            <option value="250">250×</option>
          </select>
          <span class="rp-status" id="rp-status"></span>
        </div>
      </div>

      <div class="stat-grid">
        ${statTile("Duration", U.fmtDuration(f.duration_s), "")}
        ${statTile("Distance", U.num(f.distance_km, 1), "km")}
        ${statTile("Max Alt", U.num(f.max_altitude_ft), "ft")}
        ${statTile("Avg Alt", U.num(f.avg_altitude_ft), "ft")}
        ${statTile("Max Speed", U.num(f.max_speed_kt), "kt")}
        ${statTile("Avg Speed", U.num(f.avg_speed_kt), "kt")}
      </div>

      <div class="card chart-wrap">
        <h3>Altitude Profile</h3>
        <canvas id="alt-chart"></canvas>
      </div>

      <div class="card panel weather-panel" id="weather-panel">
        <h3>Weather</h3>
        <div class="weather-grid" id="weather-tiles">${weatherSkeleton()}</div>
        <div class="weather-note muted">Weather at departure point · Open-Meteo historical data</div>
      </div>

      <div class="card panel">
        <div class="notes-row">
          <h3 style="margin:0">Pilot Notes</h3>
          <button class="btn btn-sm btn-primary" id="save-notes">Save</button>
        </div>
        <textarea id="notes" placeholder="e.g. Solo cross-country LSZG–LSZA">${U.esc(
          f.notes || ""
        )}</textarea>
      </div>
    </div>
  `;

  document.getElementById("del-flight").onclick = async () => {
    if (!confirm("Delete this flight permanently?")) return;
    try {
      await API.deleteFlight(id);
      U.toast("Flight deleted", "success");
      window.location.hash = "#/flights";
    } catch (e) {
      U.toast(e.message, "error");
    }
  };

  document.getElementById("save-notes").onclick = async () => {
    try {
      await API.updateNotes(id, document.getElementById("notes").value);
      U.toast("Notes saved", "success");
    } catch (e) {
      U.toast(e.message, "error");
    }
  };

  document.getElementById("replay-btn").onclick = () => {
    if (replay && replay.active) exitReplay();
    else enterReplay(f);
  };

  document.getElementById("threed-btn").onclick = () => {
    if (cesium3d.active) cesium3d.exit();
    else cesium3d.enter(f);
  };

  drawMap(f);
  drawAltChart(f);
  loadWeather(id);
}

/* ---- Historical weather panel (lazy, cached server-side) ---- */
function weatherSkeleton() {
  return Array.from({ length: 6 })
    .map(
      () =>
        `<div class="stat-tile weather-tile skeleton">
          <div class="sk-line sk-label"></div><div class="sk-line sk-value"></div>
        </div>`
    )
    .join("");
}

function weatherEmoji(c) {
  if (c === 0) return "☀️";
  if (c === 1 || c === 2) return "🌤";
  if (c === 3) return "☁️";
  if (c === 45 || c === 48) return "🌫";
  if (c >= 51 && c <= 67) return "🌧";
  if (c >= 71 && c <= 77) return "🌨";
  if (c >= 80 && c <= 82) return "🌧";
  if (c >= 85 && c <= 86) return "🌨";
  if (c >= 95) return "⛈";
  return "🌡";
}

function weatherTiles(w) {
  const tile = (label, value, extra = "") =>
    `<div class="stat-tile weather-tile">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${extra}
    </div>`;

  const temp =
    w.temperature_c != null ? `${U.num(w.temperature_c, 1)}<span class="unit">°C</span>` : "—";

  const windVal =
    w.windspeed_kt != null
      ? `${U.num(Math.round(w.windspeed_kt))}<span class="unit">kt</span>`
      : "—";
  const windExtra =
    w.wind_direction_deg != null
      ? `<div class="wx-sub"><span class="wx-arrow" style="transform:rotate(${w.wind_direction_deg}deg)">↑</span> ${w.wind_direction_deg}°</div>`
      : "";

  const wxExtra = `<div class="wx-sub wx-desc">${U.esc(w.weather_description || "")}</div>`;

  let visVal = "—";
  if (w.visibility_m != null) {
    const km = w.visibility_m / 1000;
    visVal = (km > 45 ? "&gt;45" : U.num(km, km < 10 ? 1 : 0)) + `<span class="unit">km</span>`;
  }

  const cloudVal =
    w.cloudcover_pct != null ? `${U.num(w.cloudcover_pct)}<span class="unit">%</span>` : "—";
  const cloudExtra =
    w.cloudcover_pct != null
      ? `<div class="wx-bar"><span style="width:${Math.max(0, Math.min(100, w.cloudcover_pct))}%"></span></div>`
      : "";

  const precipVal =
    w.precipitation_mm != null ? `${U.num(w.precipitation_mm, 1)}<span class="unit">mm</span>` : "—";

  return [
    tile("Temperature", temp),
    tile("Wind", windVal, windExtra),
    tile("Weather", `<span class="wx-icon">${weatherEmoji(w.weathercode)}</span>`, wxExtra),
    tile("Visibility", visVal),
    tile("Cloud Cover", cloudVal, cloudExtra),
    tile("Precipitation", precipVal),
  ].join("");
}

async function loadWeather(id) {
  try {
    const w = await API.getWeather(id);
    const el = document.getElementById("weather-tiles");
    if (el) el.innerHTML = weatherTiles(w);
  } catch (_) {
    const el = document.getElementById("weather-tiles");
    if (el) {
      el.innerHTML = `<div class="weather-unavailable muted">Weather data unavailable</div>`;
    }
  }
}

function statTile(label, value, unit) {
  return `<div class="stat-tile">
    <div class="label">${label}</div>
    <div class="value">${value}<span class="unit">${unit}</span></div>
  </div>`;
}

/* ---- Leaflet map with gradient track ---- */
let mapInstance = null;
let staticTrackLayer = null;

// (Re)build the green->amber->red gradient track + endpoint markers into
// staticTrackLayer. Reused for the initial render and for live updates.
function _renderStaticTrack(map, path, showLanding = true) {
  if (staticTrackLayer) map.removeLayer(staticTrackLayer);
  staticTrackLayer = L.layerGroup().addTo(map);

  const latlngs = path.map((p) => [p[1], p[2]]);
  for (let i = 0; i < latlngs.length - 1; i++) {
    const t = i / (latlngs.length - 1);
    L.polyline([latlngs[i], latlngs[i + 1]], {
      color: U.gradientColor(t),
      weight: 4,
      opacity: 0.95,
      lineCap: "round",
    }).addTo(staticTrackLayer);
  }

  const mk = (latlng, color, label) =>
    L.circleMarker(latlng, {
      radius: 7,
      color: "#0d0d0d",
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
    })
      .addTo(staticTrackLayer)
      .bindTooltip(label, { permanent: false, direction: "top" });

  if (latlngs.length) mk(latlngs[0], "#f4a7b9", "Takeoff");
  if (showLanding && latlngs.length > 1) {
    mk(latlngs[latlngs.length - 1], "#e63946", "Landing");
  }
  return latlngs;
}

function drawMap(f, opts = {}) {
  // Tear down any replay session before the map is recreated.
  stopReplay();
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  staticTrackLayer = null;

  const path = (f.track || []).filter(
    (p) => p[1] !== null && p[2] !== null
  );
  const map = L.map("map", { zoomControl: true, attributionControl: true });
  mapInstance = map;

  // CartoDB Positron (light) in light mode, Dark Matter in dark mode.
  const tileStyle = document.body.classList.contains("light-mode")
    ? "light_all"
    : "dark_all";
  L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}{r}.png`,
    {
      attribution:
        '&copy; OpenStreetMap &copy; CARTO · tracks via OpenSky Network',
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(map);

  if (path.length === 0) {
    map.setView([47.0, 8.0], 7);
    return;
  }

  const latlngs = _renderStaticTrack(map, path, opts.showLanding !== false);
  map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
}

/* ---- Altitude profile chart ---- */
let altChart = null;
function drawAltChart(f) {
  if (altChart) { altChart.destroy(); altChart = null; }
  const path = f.track || [];
  if (path.length === 0) return;

  const t0 = path[0][0];
  const points = path
    .filter((p) => p[3] !== null)
    .map((p) => ({
      x: (p[0] - t0) / 60, // minutes since takeoff
      y: p[3] * 3.28084, // feet
    }));

  // Pull theme colors from the active CSS variables so the chart matches
  // light/dark mode.
  const cv = (name) =>
    getComputedStyle(document.body).getPropertyValue(name).trim();
  const accent = cv("--amber");
  const accentRgb = cv("--accent-rgb");
  const cText = cv("--text");
  const cDim = cv("--text-dim");
  const cFaint = cv("--text-faint");
  const cPanel = cv("--bg-2");
  const cBorder = cv("--border");
  const cGrid = cv("--chart-grid");

  const ctx = document.getElementById("alt-chart").getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, `rgba(${accentRgb}, 0.35)`);
  grad.addColorStop(1, `rgba(${accentRgb}, 0.02)`);

  altChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          data: points,
          borderColor: accent,
          backgroundColor: grad,
          borderWidth: 2,
          fill: true,
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cPanel,
          borderColor: cBorder,
          borderWidth: 1,
          titleColor: cDim,
          bodyColor: cText,
          bodyFont: { family: "JetBrains Mono" },
          callbacks: {
            title: (items) => `T+${items[0].parsed.x.toFixed(1)} min`,
            label: (item) => `${Math.round(item.parsed.y).toLocaleString()} ft`,
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "minutes", color: cFaint },
          ticks: { color: cFaint, font: { family: "JetBrains Mono", size: 10 } },
          grid: { color: cGrid },
        },
        y: {
          title: { display: true, text: "feet", color: cFaint },
          ticks: { color: cFaint, font: { family: "JetBrains Mono", size: 10 } },
          grid: { color: cGrid },
        },
      },
    },
  });
}

/* ============================================================
   FLIGHT REPLAY
   ============================================================ */
let replay = null;

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;

function _haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function _bearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function _fmtHMS(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [h, m, ss].map((x) => String(x).padStart(2, "0")).join(":");
}

const _utcClockFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

const AIRCRAFT_SVG =
  '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 2c.7 0 1.2 1 1.2 2.4v4.3l7.3 4.3v1.9l-7.3-2.2v4.2l1.9 1.4v1.4L12 19.2l-3.1 1 .0-1.4 1.9-1.4v-4.2L3.5 15.4v-1.9l7.3-4.3V4.4C10.8 3 11.3 2 12 2z"/></svg>';

function _aircraftIcon() {
  return L.divIcon({
    className: "aircraft-icon",
    html: `<div class="ac-inner">${AIRCRAFT_SVG}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Stop and fully clean up any running replay (called before the map is rebuilt).
function stopReplay() {
  if (!replay) return;
  if (replay.raf) cancelAnimationFrame(replay.raf);
  replay = null;
}

function enterReplay(f) {
  if (!mapInstance) return;
  // Build a clean list of timed positions.
  const pts = (f.track || [])
    .filter((p) => p[0] != null && p[1] != null && p[2] != null)
    .map((p) => ({ t: p[0], lat: p[1], lon: p[2], altft: p[3] != null ? p[3] * M_TO_FT : null }));

  if (pts.length < 2) {
    U.toast("No track available to replay.", "error");
    return;
  }

  if (staticTrackLayer) mapInstance.removeLayer(staticTrackLayer);

  const latlngs = pts.map((p) => [p.lat, p.lon]);
  const ghost = L.polyline(latlngs, {
    color: cssVar("--text-faint"), weight: 2, opacity: 0.35, lineCap: "round",
  }).addTo(mapInstance);
  const flown = L.polyline([], {
    color: cssVar("--amber"), weight: 4, opacity: 0.95, lineCap: "round",
  }).addTo(mapInstance);
  const marker = L.marker(latlngs[0], {
    icon: _aircraftIcon(), interactive: false, keyboard: false, zIndexOffset: 1000,
  }).addTo(mapInstance);

  document.getElementById("replay-stats").hidden = false;
  document.getElementById("replay-bar").hidden = false;
  document.getElementById("replay-btn").textContent = "✕ Exit Replay";

  const speedSel = document.getElementById("rp-speed");

  replay = {
    active: true,
    playing: false,
    finished: false,
    points: pts,
    latlngs,
    t0: pts[0].t,
    duration: pts[pts.length - 1].t - pts[0].t,
    elapsed: 0,
    speed: Number(speedSel.value) || 50,
    raf: null,
    lastNow: 0,
    hdgSamples: [],       // rolling buffer of recent raw bearings
    displayHeading: null, // continuous (unwrapped) shown rotation
    ghost,
    flown,
    marker,
    iconInner: marker.getElement() ? marker.getElement().querySelector(".ac-inner") : null,
    scrub: document.getElementById("rp-scrub"),
    timeEl: document.getElementById("rp-time"),
    statusEl: document.getElementById("rp-status"),
    playBtn: document.getElementById("rp-play"),
  };

  // The marker element exists after it is added; grab the rotatable inner node.
  if (!replay.iconInner && marker.getElement()) {
    replay.iconInner = marker.getElement().querySelector(".ac-inner");
  }

  _wireReplayControls();
  _replayPlay();
}

function exitReplay() {
  if (!replay) return;
  if (replay.raf) cancelAnimationFrame(replay.raf);
  if (mapInstance) {
    mapInstance.removeLayer(replay.ghost);
    mapInstance.removeLayer(replay.flown);
    mapInstance.removeLayer(replay.marker);
    if (staticTrackLayer) staticTrackLayer.addTo(mapInstance);
  }
  document.getElementById("replay-stats").hidden = true;
  document.getElementById("replay-bar").hidden = true;
  document.getElementById("replay-btn").textContent = "▶ Replay";
  replay = null;
}

function _wireReplayControls() {
  replay.playBtn.onclick = () =>
    (replay.playing ? _replayPause() : _replayPlay());
  document.getElementById("rp-restart").onclick = () => {
    replay.elapsed = 0;
    replay.finished = false;
    _replayPlay();
  };
  document.getElementById("rp-speed").onchange = (e) => {
    replay.speed = Number(e.target.value) || 50;
  };
  replay.scrub.oninput = (e) => {
    const frac = Number(e.target.value) / 1000;
    replay.elapsed = frac * replay.duration;
    if (replay.finished && frac < 1) {
      replay.finished = false;
      replay.statusEl.textContent = "";
    }
    // Discrete jump: drop stale bearings so the icon snaps to the new heading.
    replay.hdgSamples = [];
    replay.displayHeading = null;
    _replayRender();
  };
}

function _setPlayBtn(playing) {
  replay.playBtn.textContent = playing ? "⏸" : "▶";
  replay.playBtn.title = playing ? "Pause" : "Resume";
  replay.playBtn.setAttribute("aria-label", playing ? "Pause" : "Resume");
}

function _replayPlay() {
  if (!replay) return;
  if (replay.elapsed >= replay.duration) replay.elapsed = 0; // restart from start
  replay.finished = false;
  replay.statusEl.textContent = "";
  replay.playing = true;
  replay.lastNow = performance.now();
  _setPlayBtn(true);
  replay.raf = requestAnimationFrame(_replayFrame);
}

function _replayPause() {
  if (!replay) return;
  replay.playing = false;
  if (replay.raf) cancelAnimationFrame(replay.raf);
  _setPlayBtn(false);
}

function _replayFinish() {
  replay.playing = false;
  if (replay.raf) cancelAnimationFrame(replay.raf);
  replay.finished = true;
  _setPlayBtn(false); // shows ▶ — pressing it restarts
  replay.statusEl.textContent = "Replay finished";
}

function _replayFrame(now) {
  if (!replay || !replay.playing) return;
  const dtWall = (now - replay.lastNow) / 1000;
  replay.lastNow = now;
  replay.elapsed += dtWall * replay.speed;

  if (replay.elapsed >= replay.duration) {
    replay.elapsed = replay.duration;
    _replayRender();
    _replayFinish();
    return;
  }
  _replayRender();
  replay.raf = requestAnimationFrame(_replayFrame);
}

function _replaySample(clock) {
  const pts = replay.points;
  const last = pts.length - 1;
  let i = 0;
  if (clock <= pts[0].t) i = 0;
  else if (clock >= pts[last].t) i = last - 1;
  else { while (i < last && pts[i + 1].t <= clock) i++; }

  const a = pts[i];
  const b = pts[i + 1];
  const span = (b.t - a.t) || 1;
  const frac = Math.min(1, Math.max(0, (clock - a.t) / span));

  const lat = a.lat + (b.lat - a.lat) * frac;
  const lon = a.lon + (b.lon - a.lon) * frac;
  let altft = null;
  if (a.altft != null && b.altft != null) altft = a.altft + (b.altft - a.altft) * frac;
  else altft = a.altft != null ? a.altft : b.altft;
  const hdg = _bearing(a.lat, a.lon, b.lat, b.lon);
  const distM = _haversineM(a.lat, a.lon, b.lat, b.lon);
  const spdkt = (distM / span) * MS_TO_KT;
  return { lat, lon, altft, hdg, spdkt, segIndex: i };
}

function _replayRender() {
  const s = _replaySample(replay.t0 + replay.elapsed);

  replay.marker.setLatLng([s.lat, s.lon]);
  if (!replay.iconInner && replay.marker.getElement()) {
    replay.iconInner = replay.marker.getElement().querySelector(".ac-inner");
  }

  // Smooth the heading: rolling average of the last 5 bearings (vector mean,
  // so it handles the 0/360 wrap), then turn the shortest way, capped at 30°
  // per frame. displayHeading is kept unwrapped so CSS never spins the long
  // way across the 0° boundary.
  replay.hdgSamples.push(s.hdg);
  if (replay.hdgSamples.length > 5) replay.hdgSamples.shift();
  let sx = 0, sy = 0;
  for (const ang of replay.hdgSamples) {
    const r = (ang * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const target = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
  if (replay.displayHeading === null || !replay.playing) {
    // First frame or a paused seek: snap straight to the heading.
    replay.displayHeading = target;
  } else {
    let d = (((target - replay.displayHeading) % 360) + 540) % 360 - 180;
    if (d > 30) d = 30;
    else if (d < -30) d = -30;
    replay.displayHeading += d;
  }
  if (replay.iconInner) {
    replay.iconInner.style.transform = `rotate(${replay.displayHeading}deg)`;
  }

  const flown = replay.latlngs.slice(0, s.segIndex + 1);
  flown.push([s.lat, s.lon]);
  replay.flown.setLatLngs(flown);

  // Live stats panel.
  document.getElementById("rs-alt").textContent =
    s.altft != null ? `${U.num(Math.round(s.altft))} ft` : "—";
  document.getElementById("rs-spd").textContent = `${U.num(Math.round(s.spdkt))} kt`;
  document.getElementById("rs-hdg").textContent = `${String(Math.round(s.hdg)).padStart(3, "0")}°`;
  document.getElementById("rs-time").textContent =
    _utcClockFmt.format(new Date((replay.t0 + replay.elapsed) * 1000));

  // Progress bar + elapsed display.
  const frac = replay.duration ? replay.elapsed / replay.duration : 0;
  replay.scrub.value = Math.round(frac * 1000);
  replay.scrub.style.setProperty("--rp-fill", `${frac * 100}%`);
  replay.timeEl.textContent = `${_fmtHMS(replay.elapsed)} / ${_fmtHMS(replay.duration)}`;
}

/* ============================================================
   3D FLIGHT VIEWER (Cesium, lazy-loaded)
   ============================================================ */
const cesium3d = (() => {
  const VERSION = "1.114";
  const BASE = `https://cesium.com/downloads/cesiumjs/releases/${VERSION}/Build/Cesium/`;
  let loadPromise = null;

  const state = {
    active: false,
    viewer: null,
    trackEntity: null,
    positionProperty: null,
    aircraft: null,
    playing: false,
    speed: 50,
    chase: true,
    removeTick: null,
  };

  const $c = () => document.getElementById("cesium-container");
  const $o = () => document.getElementById("cesium-overlays");

  function loadCesium() {
    if (window.Cesium) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = BASE + "Widgets/widgets.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = BASE + "Cesium.js";
      s.onload = () => resolve();
      s.onerror = () => { loadPromise = null; reject(new Error("load failed")); };
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  function message(html) {
    const o = $o();
    if (!o) return;
    o.hidden = false;
    o.innerHTML = `<div class="cesium-msg">${html}</div>`;
  }

  async function enter(flight) {
    if (state.active) return;
    state.active = true;
    document.getElementById("threed-btn").textContent = "◀ 2D";
    if (replay && replay.active) exitReplay(); // close any 2D replay first

    const mapEl = document.getElementById("map");
    if (mapEl) mapEl.style.display = "none";
    const c = $c();
    c.hidden = false;
    c.classList.add("fade-in");

    let token = "";
    try {
      token = (await API.getCesiumToken()).token || "";
    } catch (_) { /* fall through to message */ }
    if (!state.active) return;

    if (!token) {
      message(
        'Add your Cesium Ion token in <a href="#/settings">Settings</a> to enable 3D view.' +
        '<div class="muted" style="margin-top:8px">Get a free account at ' +
        '<a href="https://ion.cesium.com" target="_blank" rel="noopener">ion.cesium.com</a></div>'
      );
      return;
    }

    message('<span class="spinner"></span><div style="margin-top:10px">Loading 3D terrain…</div>');
    try {
      await loadCesium();
    } catch (_) {
      if (state.active) message("3D viewer failed to load. Check your connection.");
      return;
    }
    if (!state.active) return;
    try {
      await initViewer(token, flight);
    } catch (e) {
      message("Could not start the 3D viewer.");
    }
  }

  async function initViewer(token, flight) {
    Cesium.Ion.defaultAccessToken = token;
    const viewer = new Cesium.Viewer("cesium-container", {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      baseLayer: false,
    });
    state.viewer = viewer;

    // OpenStreetMap imagery (no extra token required).
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        credit: "© OpenStreetMap contributors",
        maximumLevel: 19,
      })
    );

    const pts = (flight.track || []).filter((p) => p[1] != null && p[2] != null);
    if (pts.length < 2) {
      message("This flight has no track to show in 3D.");
      return;
    }

    const lon = (p) => p[2];
    const lat = (p) => p[1];
    const rawAlt = (p) => (p[3] != null ? p[3] : 0);

    // OpenSky altitudes are quantized baro/MSL values (e.g. 304 m / 609 m =
    // 1000/2000 ft) and can sit BELOW the terrain — at LSZR the field is
    // ~398 m but the lowest track value reads 304 m. Lift the whole track by
    // an offset derived from the terrain height at the takeoff point:
    //   offset = terrain(takeoff) − first_track_alt + 100 m margin
    // (≈ 195 m for the LSZR example). Falls back to a fixed +200 m when
    // terrain isn't available. The quantized steps themselves are an OpenSky
    // data limitation and are left as-is.
    let altOffset = 200;
    try {
      const terrainProvider = await Cesium.createWorldTerrainAsync({
        requestVertexNormals: true,
        requestWaterMask: true,
      });
      if (!state.viewer || state.viewer !== viewer) return; // user exited
      viewer.terrainProvider = terrainProvider;

      const takeoff = [Cesium.Cartographic.fromDegrees(lon(pts[0]), lat(pts[0]))];
      await Cesium.sampleTerrainMostDetailed(terrainProvider, takeoff);
      if (!state.viewer || state.viewer !== viewer) return;
      const groundH = takeoff[0].height;
      if (groundH != null && isFinite(groundH)) {
        altOffset = Math.max(0, groundH - rawAlt(pts[0])) + 100;
      }
    } catch (_) {
      // Terrain unavailable (token/network) — keep the +200 m fallback; the
      // globe just stays ellipsoid-smooth.
    }
    const elev = (p) => rawAlt(p) + altOffset;

    // Dual-line (à la ForeFlight/SkyVector):
    // 1) a thin white "shadow" clamped to the ground to show the map path,
    const groundFlat = [];
    pts.forEach((p) => groundFlat.push(lon(p), lat(p)));
    viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(groundFlat),
        width: 1,
        clampToGround: true,
        material: Cesium.Color.WHITE.withAlpha(0.6),
      },
    });

    // 2) the actual flight path elevated at altitude (+offset).
    const flat = [];
    pts.forEach((p) => flat.push(lon(p), lat(p), elev(p)));
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights(flat);
    viewer.entities.add({
      polyline: {
        positions,
        width: 3,
        clampToGround: false,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.fromCssColorString("#c0392b"),
        }),
      },
    });

    // Takeoff / landing markers — clamped to the surface so they sit on terrain.
    const marker = (p, hex) => ({
      position: Cesium.Cartesian3.fromDegrees(lon(p), lat(p)),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString(hex),
        outlineColor: Cesium.Color.fromCssColorString("#0d0d0d"),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    viewer.entities.add(marker(pts[0], "#22c55e")); // takeoff
    viewer.entities.add(marker(pts[pts.length - 1], "#e63946")); // landing

    // Time-sampled position for replay — same elevated altitude as the line.
    const property = new Cesium.SampledPositionProperty();
    pts.forEach((p) =>
      property.addSample(
        Cesium.JulianDate.fromDate(new Date(p[0] * 1000)),
        Cesium.Cartesian3.fromDegrees(lon(p), lat(p), elev(p))
      )
    );
    property.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });
    state.positionProperty = property;

    const startJd = Cesium.JulianDate.fromDate(new Date(pts[0][0] * 1000));
    const stopJd = Cesium.JulianDate.fromDate(new Date(pts[pts.length - 1][0] * 1000));

    // Aircraft: an elongated box; VelocityOrientationProperty aligns +X (its
    // long axis) to the direction of travel, giving correct heading + pitch.
    state.aircraft = viewer.entities.add({
      position: property,
      orientation: new Cesium.VelocityOrientationProperty(property),
      box: {
        dimensions: new Cesium.Cartesian3(180, 70, 28),
        material: Cesium.Color.fromCssColorString("#c0392b"),
        outline: true,
        outlineColor: Cesium.Color.WHITE,
      },
      show: false,
    });

    viewer.clock.startTime = startJd.clone();
    viewer.clock.stopTime = stopJd.clone();
    viewer.clock.currentTime = startJd.clone();
    viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    viewer.clock.multiplier = state.speed;
    viewer.clock.shouldAnimate = false;

    // Camera: above the track centre at ~45° looking down, high enough to see
    // the whole route (and at least ~3× the max flight altitude up).
    const maxAlt = Math.max(1000, ...pts.map(elev));
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    const range = Math.max(sphere.radius * 2.2, maxAlt * 3);
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.4,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(30),
        Cesium.Math.toRadians(-45),
        range
      ),
    });

    buildOverlays();
  }

  function buildOverlays() {
    const o = $o();
    o.hidden = false;
    o.innerHTML = `
      <div class="cz-controls">
        <button class="rp-btn" id="cz-play" title="Replay" aria-label="Replay">▶</button>
        <select class="rp-speed" id="cz-speed" aria-label="Playback speed">
          <option value="10">10×</option>
          <option value="50" selected>50×</option>
          <option value="100">100×</option>
          <option value="250">250×</option>
        </select>
      </div>
      <button class="cz-cam" id="cz-cam" type="button">Chase</button>
      <div class="replay-stats cz-stats" id="cz-stats" hidden>
        <div class="rs-item"><span class="rs-l">ALT</span><span class="rs-v" id="cz-alt">—</span></div>
        <div class="rs-item"><span class="rs-l">SPD</span><span class="rs-v" id="cz-spd">—</span></div>
        <div class="rs-item"><span class="rs-l">HDG</span><span class="rs-v" id="cz-hdg">—</span></div>
        <div class="rs-item"><span class="rs-l">TIME</span><span class="rs-v" id="cz-time">—</span></div>
      </div>`;
    document.getElementById("cz-play").onclick = togglePlay;
    document.getElementById("cz-speed").onchange = (e) => {
      state.speed = Number(e.target.value) || 50;
      if (state.viewer) state.viewer.clock.multiplier = state.speed;
    };
    document.getElementById("cz-cam").onclick = toggleCamera;
    state.removeTick = state.viewer.clock.onTick.addEventListener(onTick);
  }

  function togglePlay() {
    const v = state.viewer;
    if (!v) return;
    const btn = document.getElementById("cz-play");
    if (v.clock.shouldAnimate) {
      v.clock.shouldAnimate = false;
      state.playing = false;
      btn.textContent = "▶";
      btn.title = "Resume";
    } else {
      if (Cesium.JulianDate.greaterThanOrEquals(v.clock.currentTime, v.clock.stopTime)) {
        v.clock.currentTime = v.clock.startTime.clone();
      }
      state.aircraft.show = true;
      v.clock.multiplier = state.speed;
      v.clock.shouldAnimate = true;
      state.playing = true;
      btn.textContent = "⏸";
      btn.title = "Pause";
      document.getElementById("cz-stats").hidden = false;
      if (state.chase) v.trackedEntity = state.aircraft;
    }
  }

  function toggleCamera() {
    state.chase = !state.chase;
    const btn = document.getElementById("cz-cam");
    if (btn) btn.textContent = state.chase ? "Chase" : "Free";
    if (state.viewer) {
      state.viewer.trackedEntity =
        state.chase && state.playing ? state.aircraft : undefined;
    }
  }

  function onTick() {
    const v = state.viewer;
    if (!v || !state.positionProperty) return;
    const t = v.clock.currentTime;
    const p1 = state.positionProperty.getValue(t);
    if (!p1) return;
    const c1 = Cesium.Cartographic.fromCartesian(p1);
    let spdkt = 0;
    let hdg = 0;
    const t2 = Cesium.JulianDate.addSeconds(t, 1, new Cesium.JulianDate());
    const p2 = state.positionProperty.getValue(t2);
    if (p2) {
      const c2 = Cesium.Cartographic.fromCartesian(p2);
      const lat1 = Cesium.Math.toDegrees(c1.latitude);
      const lon1 = Cesium.Math.toDegrees(c1.longitude);
      const lat2 = Cesium.Math.toDegrees(c2.latitude);
      const lon2 = Cesium.Math.toDegrees(c2.longitude);
      spdkt = _haversineM(lat1, lon1, lat2, lon2) * MS_TO_KT; // metres per 1 s
      hdg = _bearing(lat1, lon1, lat2, lon2);
    }
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("cz-alt", `${U.num(Math.round(c1.height * 3.28084))} ft`);
    set("cz-spd", `${U.num(Math.round(spdkt))} kt`);
    set("cz-hdg", `${String(Math.round(hdg)).padStart(3, "0")}°`);
    set("cz-time", Cesium.JulianDate.toIso8601(t, 0).slice(11, 19));

    if (state.playing && Cesium.JulianDate.greaterThanOrEquals(t, v.clock.stopTime)) {
      state.playing = false;
      v.clock.shouldAnimate = false;
      const btn = document.getElementById("cz-play");
      if (btn) { btn.textContent = "▶"; btn.title = "Replay again"; }
    }
  }

  function cleanup() {
    if (state.removeTick) { try { state.removeTick(); } catch (_) {} state.removeTick = null; }
    if (state.viewer) { try { state.viewer.destroy(); } catch (_) {} state.viewer = null; }
    state.active = false;
    state.playing = false;
    state.positionProperty = null;
    state.aircraft = null;
    state.trackEntity = null;
    const c = $c();
    if (c) { c.hidden = true; c.classList.remove("fade-in"); }
    const o = $o();
    if (o) { o.hidden = true; o.innerHTML = ""; }
  }

  function exit() {
    cleanup();
    const btn = document.getElementById("threed-btn");
    if (btn) btn.textContent = "🌐 3D";
    const mapEl = document.getElementById("map");
    if (mapEl) mapEl.style.display = "";
    if (mapInstance) {
      setTimeout(() => { try { mapInstance.invalidateSize(); } catch (_) {} }, 60);
    }
  }

  return {
    enter,
    exit,
    cleanup,
    get active() { return state.active; },
  };
})();

/* ============================================================
   MANUAL FLIGHT ENTRY
   ============================================================ */
async function renderNew() {
  loading("Preparing");
  try {
    await ensureAircraft();
  } catch (e) {
    view.innerHTML = errorBox(e.message);
    return;
  }

  if (aircraftCache.length === 0) {
    view.innerHTML = `<div class="empty">
      <div class="big">✈</div>
      <div>No aircraft configured.</div>
      <a class="btn btn-primary row-gap" href="#/settings">Add an aircraft</a>
    </div>`;
    return;
  }

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;

  const acOptions = aircraftCache
    .map((a) => {
      const missing = !a.icao24;
      const label = `${a.registration}${a.nickname ? " · " + a.nickname : ""} — ${a.model}${
        missing ? "  (no ICAO24)" : ""
      }`;
      return `<option value="${a.id}" ${missing ? "disabled" : ""}>${U.esc(label)}</option>`;
    })
    .join("");

  view.innerHTML = `
    <div class="page-head"><h1>Log a Flight</h1></div>

    <div class="card panel" style="max-width:640px">
      <p class="muted" style="margin-top:0">
        Pick the aircraft and a time <strong>during</strong> the flight, then choose
        the exact flight from the results below. OpenSky resolves the full track
        automatically — no need for precise start/end times.
      </p>

      <div class="form-note">
        ℹ️ Flights typically appear in OpenSky's historical database 1–2 days
        after they occur. If a recent flight isn't showing up, check back tomorrow.
      </div>

      <label class="field">
        <span>Aircraft</span>
        <select id="n-aircraft">${acOptions}</select>
      </label>

      <div class="form-grid">
        <label class="field">
          <span>Date (UTC)</span>
          <input type="date" id="n-date" value="${today}" />
        </label>
        <label class="field">
          <span>Approx. time during flight (UTC)</span>
          <input type="time" id="n-time" value="12:00" />
        </label>
      </div>
      <div class="hint">Times are UTC. Pick any moment while the aircraft was airborne.</div>

      <label class="field">
        <span>Notes (optional)</span>
        <textarea id="n-notes" placeholder="e.g. Solo cross-country LSZG–LSZA"></textarea>
      </label>

      <div class="flex flex-end row-gap">
        <a class="btn btn-ghost" href="#/flights">Cancel</a>
        <button class="btn btn-primary" id="n-find">🔍 Find Flights</button>
      </div>
    </div>

    <div id="discovery" class="row-gap"></div>
  `;

  // Re-run discovery whenever the aircraft/date/time changes, and on demand.
  const trigger = () => runDiscovery();
  document.getElementById("n-aircraft").onchange = trigger;
  document.getElementById("n-date").onchange = trigger;
  document.getElementById("n-time").onchange = trigger;
  document.getElementById("n-find").onclick = trigger;
}

// Parse the form's UTC date+time into a unix timestamp, or null if incomplete.
function newFormTimestamp() {
  const date = document.getElementById("n-date").value;
  const time = document.getElementById("n-time").value;
  if (!date || !time) return null;
  const ts = Math.floor(Date.parse(`${date}T${time}:00Z`) / 1000);
  return Number.isNaN(ts) ? null : ts;
}

// Incremented per request so out-of-order responses (from rapid field
// changes) can't overwrite a newer result.
let discoverySeq = 0;

async function runDiscovery() {
  const box = document.getElementById("discovery");
  if (!box) return;

  const aircraftId = Number(document.getElementById("n-aircraft").value);
  const ts = newFormTimestamp();
  if (!aircraftId || ts === null) {
    box.innerHTML = "";
    return;
  }

  const seq = ++discoverySeq;
  box.innerHTML = `<div class="card panel"><div class="empty" style="padding:36px">
    <span class="spinner"></span>
    <div style="margin-top:12px">Searching OpenSky for flights ±6 h…</div>
  </div></div>`;

  try {
    const flights = await API.discoverFlights({ aircraft_id: aircraftId, time: ts });
    if (seq !== discoverySeq) return; // a newer request superseded this one
    drawDiscovery(flights, ts, aircraftId);
  } catch (e) {
    if (seq !== discoverySeq) return;
    box.innerHTML = `<div class="card panel"><div class="empty" style="padding:36px">
      <div class="big">⚠</div><div>${U.esc(e.message)}</div>
    </div></div>`;
  }
}

function drawDiscovery(flights, ts, aircraftId) {
  const box = document.getElementById("discovery");

  if (!flights.length) {
    box.innerHTML = `<div class="card panel"><div class="empty" style="padding:40px">
      <div class="big">🔍</div>
      <div>No flights found in this window.</div>
      <div class="muted" style="margin-top:8px;max-width:430px;margin-left:auto;margin-right:auto">
        OpenSky has no flights for this aircraft within ±6 h of the time you entered.
        Try a different time and make sure it falls while the aircraft was airborne.
      </div>
    </div></div>`;
    return;
  }

  const zoneCell = (t) =>
    `${U.fmtZoned(t, "UTC", true)}<span class="z">UTC</span>` +
    `<div class="zrh">${U.fmtZoned(t, "Europe/Zurich")}<span class="z">ZRH</span></div>`;

  const rows = flights
    .map((fl) => {
      const match = ts >= fl.first_seen && ts <= fl.last_seen;
      const action = fl.already_logged
        ? `<button class="btn btn-sm btn-ghost" disabled>Already logged</button>`
        : `<button class="btn btn-sm btn-primary" data-add="${fl.first_seen}">Add</button>`;
      return `<tr class="${match ? "row-match" : ""}">
        <td>${zoneCell(fl.first_seen)}${match ? `<span class="match-tag">your time</span>` : ""}</td>
        <td>${zoneCell(fl.last_seen)}</td>
        <td>${U.fmtDuration(fl.duration_s)}</td>
        <td>${fl.callsign ? U.esc(fl.callsign) : "—"}</td>
        <td style="text-align:right;white-space:nowrap">${action}</td>
      </tr>`;
    })
    .join("");

  box.innerHTML = `<div class="card panel">
    <h3 class="section-title">Flights Found
      <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">
        · ${flights.length} in ±6 h · Add archives the flight with your notes</span>
    </h3>
    <div style="overflow-x:auto">
      <table class="disc-table">
        <thead><tr>
          <th>Departure</th><th>Arrival</th><th>Duration</th><th>Callsign</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;

  box.querySelectorAll("[data-add]").forEach((btn) => {
    btn.onclick = () => addDiscoveredFlight(btn, aircraftId, Number(btn.dataset.add));
  });
}

async function addDiscoveredFlight(btn, aircraftId, firstSeen) {
  const notes = document.getElementById("n-notes").value;
  const addButtons = document.querySelectorAll("#discovery [data-add]");
  addButtons.forEach((b) => (b.disabled = true));
  const original = btn.innerHTML;
  btn.innerHTML = `<span class="spinner"></span> Fetching…`;

  try {
    // Use the departure timestamp so /tracks/all resolves this exact flight.
    const flight = await API.createFlight({
      aircraft_id: aircraftId,
      time: firstSeen,
      notes,
    });
    U.toast("Flight archived", "success");
    window.location.hash = `#/flights/${flight.id}`;
  } catch (e) {
    U.toast(e.message, "error");
    addButtons.forEach((b) => (b.disabled = false));
    btn.innerHTML = original;
  }
}

/* ============================================================
   STATISTICS
   ============================================================ */
let statsCharts = [];
function destroyStatsCharts() {
  statsCharts.forEach((c) => c.destroy());
  statsCharts = [];
}

// Read a CSS custom property from the active theme (light/dark aware).
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

async function renderStats() {
  destroyStatsCharts();
  loading("Loading statistics");

  let s;
  try {
    s = await API.getStats();
  } catch (e) {
    view.innerHTML = errorBox(e.message);
    return;
  }

  const kpi = (val, label, sub = "") => `
    <div class="card kpi">
      <div class="value">${val}</div>
      <div class="label">${U.esc(label)}</div>
      ${sub ? `<div class="kpi-sub muted">${U.esc(sub)}</div>` : ""}
    </div>`;

  const t = s.totals;
  const kpis = [
    kpi(U.num(t.flights), "Total Flights"),
    kpi(U.fmtDuration(t.time_s), "Total Flight Time"),
    kpi(U.num(t.distance_km, 1), "Total Distance (km)"),
    kpi(U.num(t.airports), "Airports Visited"),
  ].join("");

  const record = (r, label, fmt) => {
    if (!r) {
      return `<div class="card record">
        <div class="r-label">${label}</div>
        <div class="r-value">—</div>
        <div class="r-date muted">No data</div>
      </div>`;
    }
    return `<div class="card record clickable" data-flight="${r.flight_id}">
      <div class="r-label">${label}</div>
      <div class="r-value">${fmt(r.value)}</div>
      <div class="r-date">${U.fmtDate(r.date)}</div>
    </div>`;
  };

  const recs = [
    record(s.records.longest, "Longest Flight", (v) => U.fmtDuration(v)),
    record(s.records.furthest, "Furthest Flight", (v) => `${U.num(v, 1)} km`),
    record(s.records.highest, "Highest Altitude", (v) => `${U.num(v)} ft`),
    record(s.records.fastest, "Fastest Speed", (v) => `${U.num(v)} kt`),
  ].join("");

  const a = s.activity;
  const activity = [
    kpi(`${a.current_streak}`, a.current_streak === 1 ? "Current Streak (day)" : "Current Streak (days)"),
    kpi(`${a.longest_streak}`, a.longest_streak === 1 ? "Longest Streak (day)" : "Longest Streak (days)"),
    kpi(a.busiest_day ? U.num(a.busiest_day.count) : "—", "Busiest Day", a.busiest_day ? a.busiest_day.date : ""),
    kpi(U.fmtDuration(a.avg_duration_s), "Avg Flight Duration"),
    kpi(U.num(a.avg_flights_per_week, 1), "Avg Flights / Week"),
  ].join("");

  view.innerHTML = `
    <div class="page-head"><h1>Statistics</h1></div>

    <div class="kpi-grid">${kpis}</div>

    <h2 class="stats-h">Personal Records</h2>
    <div class="records-grid">${recs}</div>

    <h2 class="stats-h">Trends · last 12 months</h2>
    <div class="stats-charts">
      <div class="card chart-wrap"><h3>Flights per Month</h3><canvas id="ch-flights"></canvas></div>
      <div class="card chart-wrap"><h3>Flight Time per Month</h3><canvas id="ch-time"></canvas></div>
      <div class="card chart-wrap"><h3>Distance per Month</h3><canvas id="ch-dist"></canvas></div>
    </div>

    <h2 class="stats-h">Activity</h2>
    <div class="kpi-grid">${activity}</div>

    ${perAircraftSection(s.per_aircraft)}
  `;

  view.querySelectorAll(".record.clickable").forEach((c) => {
    c.onclick = () => { window.location.hash = `#/flights/${c.dataset.flight}`; };
  });

  const mo = s.monthly;
  drawBarChart("ch-flights", mo.labels, mo.flights, (v) => `${v} flight${v === 1 ? "" : "s"}`);
  drawBarChart("ch-time", mo.labels, mo.time_s.map((x) => x / 3600),
    (v) => U.fmtDuration(Math.round(v * 3600)));
  drawBarChart("ch-dist", mo.labels, mo.distance_km, (v) => `${U.num(v, 1)} km`);
}

function perAircraftSection(list) {
  if (!list || list.length <= 1) return "";
  const rows = list
    .map(
      (r) => `<tr>
        <td>${U.esc(r.registration)}${r.nickname ? " · " + U.esc(r.nickname) : ""}</td>
        <td>${U.num(r.flights)}</td>
        <td>${U.fmtDuration(r.time_s)}</td>
        <td>${U.num(r.distance_km, 1)}</td>
        <td>${U.fmtDuration(r.avg_duration_s)}</td>
      </tr>`
    )
    .join("");
  return `
    <h2 class="stats-h">Per Aircraft</h2>
    <div class="card panel">
      <div style="overflow-x:auto">
        <table class="stats-table">
          <thead><tr>
            <th>Aircraft</th><th>Flights</th><th>Total Time</th>
            <th>Distance (km)</th><th>Avg Duration</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// Bar chart matching the altitude profile chart's theme handling.
function drawBarChart(canvasId, labels, data, valueFmt) {
  const accent = cssVar("--amber");
  const accentRgb = cssVar("--accent-rgb");
  const cText = cssVar("--text");
  const cDim = cssVar("--text-dim");
  const cFaint = cssVar("--text-faint");
  const cPanel = cssVar("--bg-2");
  const cBorder = cssVar("--border");
  const cGrid = cssVar("--chart-grid");

  const ctx = document.getElementById(canvasId).getContext("2d");
  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: `rgba(${accentRgb}, 0.65)`,
          hoverBackgroundColor: accent,
          borderRadius: 4,
          maxBarThickness: 46,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cPanel,
          borderColor: cBorder,
          borderWidth: 1,
          titleColor: cDim,
          bodyColor: cText,
          bodyFont: { family: "JetBrains Mono" },
          callbacks: { label: (item) => valueFmt(item.parsed.y) },
        },
      },
      scales: {
        x: {
          ticks: { color: cFaint, font: { family: "JetBrains Mono", size: 10 } },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: cFaint, font: { family: "JetBrains Mono", size: 10 }, precision: 0 },
          grid: { color: cGrid },
        },
      },
    },
  });
  statsCharts.push(chart);
}

/* ============================================================
   AIRPORTS MAP
   ============================================================ */
let airportsMap = null;
const geocodeCache = {};

// Reverse geocode a coordinate to a best-guess airfield/place name. Results
// are cached in memory; failures are not cached so they can be retried.
async function reverseGeocode(lat, lon) {
  const key = lat.toFixed(3) + "," + lon.toFixed(3);
  if (geocodeCache[key]) return geocodeCache[key];
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("geocode failed");
    const d = await res.json();
    const a = d.address || {};
    const name =
      d.name ||
      a.aerodrome || a.aeroway || a.airport ||
      a.hamlet || a.village || a.town || a.city || a.municipality ||
      (d.display_name ? d.display_name.split(",")[0] : null) ||
      "Unknown location";
    geocodeCache[key] = name;
    return name;
  } catch (_) {
    return "Name unavailable";
  }
}

async function renderAirports() {
  if (airportsMap) {
    try { airportsMap.remove(); } catch (_) {}
    airportsMap = null;
  }
  loading("Loading airports");

  let data;
  try {
    data = await API.getAirports();
  } catch (e) {
    view.innerHTML = errorBox(e.message);
    return;
  }

  if (!data.airports.length) {
    view.innerHTML = `<div class="empty" style="padding:90px 20px">
      <div class="big">🗺</div>
      <div>No flights logged yet</div>
    </div>`;
    return;
  }

  view.innerHTML = `<div id="airports-map"></div>`;

  const light = document.body.classList.contains("light-mode");
  const tileStyle = light ? "light_all" : "dark_all";
  const map = L.map("airports-map", { zoomControl: false });
  airportsMap = map;
  L.control.zoom({ position: "topright" }).addTo(map);

  L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}{r}.png`,
    {
      attribution:
        "&copy; OpenStreetMap &copy; CARTO · tracks via OpenSky Network",
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(map);

  // Overlaid info panel (top-left).
  const info = L.control({ position: "topleft" });
  info.onAdd = () => {
    const div = L.DomUtil.create("div", "airports-info");
    div.innerHTML =
      `<div class="ai-row"><span class="ai-val">${data.total_airports}</span> airport${data.total_airports === 1 ? "" : "s"}</div>` +
      `<div class="ai-row"><span class="ai-val">${data.total_flights}</span> flight${data.total_flights === 1 ? "" : "s"}</div>`;
    return div;
  };
  info.addTo(map);

  const accent = cssVar("--amber");
  const latlngs = [];
  data.airports.forEach((ap) => {
    latlngs.push([ap.lat, ap.lon]);
    // Radius scales with how many flights touched the airport.
    const touches = ap.flights.length;
    const radius = 6 + Math.min(Math.max(touches - 1, 0), 5) * 1.4;
    const marker = L.circleMarker([ap.lat, ap.lon], {
      radius,
      color: "#ffffff",
      weight: 2,
      fillColor: accent,
      fillOpacity: 1,
    }).addTo(map);
    marker.bindPopup(airportPopupHtml(ap), { minWidth: 220, maxHeight: 300 });
    marker.on("popupopen", (e) => onAirportPopupOpen(e, ap));
  });

  map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50], maxZoom: 12 });
}

function airportPopupHtml(ap) {
  const key = ap.lat.toFixed(3) + "," + ap.lon.toFixed(3);
  const cached = geocodeCache[key];
  const flights = ap.flights
    .slice()
    .sort((a, b) => b.date - a.date)
    .map(
      (f) => `<a class="ap-flight" data-flight="${f.id}">
        <span>${U.fmtDate(f.date)}</span>
        <span class="ap-dur">${U.fmtDuration(f.duration_s)}</span>
      </a>`
    )
    .join("");
  return `<div class="ap-pop">
    <div class="ap-name">${cached ? U.esc(cached) : "Locating…"}</div>
    <div class="ap-stats">
      <div>
        <span class="ap-num">${ap.landings}</span> landing${ap.landings === 1 ? "" : "s"}
        · <span class="ap-num">${ap.departures}</span> departure${ap.departures === 1 ? "" : "s"}
      </div>
      <div class="ap-dates">First seen ${U.zurichDateKey(ap.first_contact)} · Last seen ${U.zurichDateKey(ap.last_contact)}</div>
    </div>
    <div class="ap-flights">${flights}</div>
  </div>`;
}

async function onAirportPopupOpen(e, ap) {
  const el = e.popup.getElement();
  if (!el) return;

  // Make the flight rows navigate to their detail view.
  el.querySelectorAll(".ap-flight[data-flight]").forEach((a) => {
    a.onclick = () => { window.location.hash = `#/flights/${a.dataset.flight}`; };
  });

  // Reverse geocode the airfield name on demand (cached).
  const nameEl = el.querySelector(".ap-name");
  if (nameEl && nameEl.textContent === "Locating…") {
    const name = await reverseGeocode(ap.lat, ap.lon);
    const current = e.popup.getElement();
    const target = current ? current.querySelector(".ap-name") : null;
    if (target) target.textContent = name;
  }
}

/* ============================================================
   HEATMAP
   ============================================================ */
let heatmapMap = null;

async function renderHeatmap() {
  if (heatmapMap) {
    try { heatmapMap.remove(); } catch (_) {}
    heatmapMap = null;
  }
  loading("Loading heatmap");

  let data, aircraft;
  try {
    [data, aircraft] = await Promise.all([API.getHeatmap(), API.listAircraft()]);
  } catch (e) {
    view.innerHTML = errorBox(e.message);
    return;
  }

  if (!data.flights.length) {
    view.innerHTML = `<div class="empty" style="padding:90px 20px">
      <div class="big">🔥</div>
      <div>No flights logged yet</div>
    </div>`;
    return;
  }

  view.innerHTML = `<div id="heatmap-map"></div>`;

  const light = document.body.classList.contains("light-mode");
  const tileStyle = light ? "light_all" : "dark_all";
  const map = L.map("heatmap-map", { zoomControl: false });
  heatmapMap = map;
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}{r}.png`,
    {
      attribution:
        "&copy; OpenStreetMap &copy; CARTO · tracks via OpenSky Network",
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(map);

  const state = {
    aircraftId: "",
    showMarkers: true,
    trackLayer: null,
    markerLayer: null,
  };

  // Overlaid controls panel (top-left).
  const ctrl = L.control({ position: "topleft" });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create("div", "airports-info heat-controls");
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    div.innerHTML =
      `<div class="ai-row"><span class="ai-val" id="heat-count">0</span> flights shown</div>` +
      `<label class="heat-field"><span>Aircraft</span>` +
      `<select id="heat-aircraft"><option value="">All aircraft</option>` +
      aircraft
        .map(
          (a) =>
            `<option value="${a.id}">${U.esc(a.registration)}${a.nickname ? " · " + U.esc(a.nickname) : ""}</option>`
        )
        .join("") +
      `</select></label>` +
      `<button class="btn btn-sm heat-toggle" id="heat-toggle" type="button">Show tracks only</button>`;
    return div;
  };
  ctrl.addTo(map);

  document.getElementById("heat-aircraft").onchange = (e) => {
    state.aircraftId = e.target.value;
    drawHeatTracks();
  };
  document.getElementById("heat-toggle").onclick = (e) => {
    state.showMarkers = !state.showMarkers;
    e.target.textContent = state.showMarkers ? "Show tracks only" : "Show all routes";
    applyHeatMarkers();
  };

  function applyHeatMarkers() {
    if (!state.markerLayer) return;
    if (state.showMarkers) state.markerLayer.addTo(map);
    else map.removeLayer(state.markerLayer);
  }

  function drawHeatTracks() {
    if (state.trackLayer) map.removeLayer(state.trackLayer);
    if (state.markerLayer) map.removeLayer(state.markerLayer);
    state.trackLayer = L.layerGroup().addTo(map);
    state.markerLayer = L.layerGroup();

    const accent = cssVar("--amber");
    const flights = state.aircraftId
      ? data.flights.filter((f) => String(f.aircraft_id) === String(state.aircraftId))
      : data.flights;

    const allLatLngs = [];
    const endpoints = new Map();

    flights.forEach((f) => {
      const pts = (f.track || [])
        .filter((p) => p[1] !== null && p[2] !== null)
        .map((p) => [p[1], p[2]]);
      if (pts.length < 2) return;

      pts.forEach((ll) => allLatLngs.push(ll));

      const line = L.polyline(pts, {
        color: accent,
        weight: 3,
        opacity: 0.2,
        lineCap: "round",
        lineJoin: "round",
        className: "heat-track",
      });
      line.on("mouseover", () => { line.setStyle({ opacity: 0.85, weight: 5 }); line.bringToFront(); });
      line.on("mouseout", () => { line.setStyle({ opacity: 0.2, weight: 3 }); });
      line.on("click", () => { window.location.hash = `#/flights/${f.id}`; });
      line.bindTooltip(
        `<div class="heat-tip"><b>${U.fmtDate(f.date)}</b><br>` +
        `${U.esc(f.registration || "—")} · ${U.fmtDuration(f.duration_s)}</div>`,
        { sticky: true, direction: "top", className: "heat-tooltip" }
      );
      line.addTo(state.trackLayer);

      [pts[0], pts[pts.length - 1]].forEach(([la, lo]) => {
        const key = la.toFixed(2) + "," + lo.toFixed(2);
        if (!endpoints.has(key)) endpoints.set(key, [la, lo]);
      });
    });

    endpoints.forEach(([la, lo]) => {
      L.circleMarker([la, lo], {
        radius: 5,
        color: "#ffffff",
        weight: 1.5,
        fillColor: accent,
        fillOpacity: 0.9,
      }).addTo(state.markerLayer);
    });

    applyHeatMarkers();
    document.getElementById("heat-count").textContent = flights.length;

    if (allLatLngs.length) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [50, 50] });
    }
  }

  drawHeatTracks();
}

/* ============================================================
   SETTINGS
   ============================================================ */
async function renderSettings() {
  loading("Loading settings");
  let settings, aircraft;
  try {
    [settings, aircraft] = await Promise.all([API.getSettings(), API.listAircraft()]);
    aircraftCache = aircraft;
  } catch (e) {
    view.innerHTML = errorBox(e.message);
    return;
  }

  view.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>

    <div class="card panel" style="margin-bottom:16px">
      <h3 class="section-title">Aircraft</h3>
      <div style="overflow-x:auto">
        <table class="ac-table" id="ac-table">
          <thead>
            <tr>
              <th>Registration</th><th>ICAO24</th><th>Model</th>
              <th>Nickname</th><th>Color</th><th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="row-gap">
        <button class="btn btn-primary btn-sm" id="add-ac">＋ Add aircraft</button>
      </div>
    </div>

    <div class="settings-cols">
      <div class="card panel">
        <h3 class="section-title">OpenSky API Credentials</h3>
        <p class="muted" style="margin-top:0;font-size:13px">
          OAuth2 client credentials. Stored locally and used as a Bearer token,
          refreshed automatically.
        </p>
        <label class="field">
          <span>Client ID</span>
          <input id="s-client-id" value="${U.esc(settings.opensky_client_id)}" placeholder="opensky-client-id" />
        </label>
        <label class="field">
          <span>Client Secret</span>
          <input id="s-client-secret" type="password"
            placeholder="${settings.opensky_secret_set ? "•••••• (stored — leave blank to keep)" : "client secret"}" />
        </label>
        <div class="flex flex-end">
          <button class="btn btn-primary btn-sm" id="save-creds">Save credentials</button>
        </div>
      </div>

      <div class="card panel">
        <h3 class="section-title">Application</h3>
        <label class="field">
          <span>App Title</span>
          <input id="s-title" value="${U.esc(settings.app_title)}" />
        </label>
        <label class="field">
          <span>Pilot Name</span>
          <input id="s-pilot" value="${U.esc(settings.pilot_name)}" placeholder="e.g. J. Vogt" />
        </label>
        <div class="flex flex-end">
          <button class="btn btn-primary btn-sm" id="save-app">Save</button>
        </div>
      </div>

      <div class="card panel">
        <h3 class="section-title">3D Map</h3>
        <p class="muted" style="margin-top:0;font-size:13px">
          Cesium Ion access token for the 3D flight viewer — free account at
          <a href="https://ion.cesium.com" target="_blank" rel="noopener" style="color:var(--amber)">ion.cesium.com</a>.
        </p>
        <label class="field">
          <span>Cesium Ion Token</span>
          <input id="s-cesium" placeholder="${
            settings.cesium_token_set
              ? "•••• (" + U.esc(settings.cesium_token_masked) + " — saved)"
              : "Get a free token at ion.cesium.com"
          }" />
        </label>
        <div class="flex flex-end">
          <button class="btn btn-primary btn-sm" id="save-cesium">Save</button>
        </div>
      </div>
    </div>
  `;

  drawAircraftRows();

  document.getElementById("add-ac").onclick = () => openAircraftModal();
  document.getElementById("save-creds").onclick = async () => {
    try {
      await API.updateSettings({
        opensky_client_id: document.getElementById("s-client-id").value,
        opensky_client_secret: document.getElementById("s-client-secret").value,
      });
      U.toast("Credentials saved", "success");
      renderSettings();
    } catch (e) {
      U.toast(e.message, "error");
    }
  };
  document.getElementById("save-app").onclick = async () => {
    try {
      await API.updateSettings({
        app_title: document.getElementById("s-title").value,
        pilot_name: document.getElementById("s-pilot").value,
      });
      U.toast("Saved", "success");
      loadBranding();
    } catch (e) {
      U.toast(e.message, "error");
    }
  };
  document.getElementById("save-cesium").onclick = async () => {
    const value = document.getElementById("s-cesium").value.trim();
    if (!value) {
      U.toast("Enter a Cesium Ion token.", "error");
      return;
    }
    try {
      await API.updateSettings({ cesium_token: value });
      U.toast("Cesium token saved", "success");
      renderSettings();
    } catch (e) {
      U.toast(e.message, "error");
    }
  };
}

function drawAircraftRows() {
  const tbody = document.querySelector("#ac-table tbody");
  tbody.innerHTML = "";
  if (aircraftCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No aircraft yet.</td></tr>`;
    return;
  }
  aircraftCache.forEach((a) => {
    const tr = U.html(`
      <tr>
        <td>${U.esc(a.registration)}</td>
        <td>${a.icao24 ? U.esc(a.icao24) : '<span class="badge-missing">not set</span>'}</td>
        <td>${U.esc(a.model || "")}</td>
        <td>${U.esc(a.nickname || "")}</td>
        <td>${a.color ? `<span class="swatch" style="background:${U.esc(a.color)}"></span> ${U.esc(a.color)}` : "—"}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm btn-ghost" data-edit="${a.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-del="${a.id}">Delete</button>
        </td>
      </tr>
    `);
    tr.querySelector("[data-edit]").onclick = () => openAircraftModal(a);
    tr.querySelector("[data-del]").onclick = async () => {
      if (!confirm(`Delete ${a.registration}? Its flights will be removed too.`)) return;
      try {
        await API.deleteAircraft(a.id);
        U.toast("Aircraft deleted", "success");
        renderSettings();
      } catch (e) {
        U.toast(e.message, "error");
      }
    };
    tbody.appendChild(tr);
  });
}

function openAircraftModal(a = null) {
  const isEdit = !!a;
  const backdrop = U.html(`
    <div class="modal-backdrop">
      <div class="card modal">
        <h2>${isEdit ? "Edit Aircraft" : "Add Aircraft"}</h2>
        <label class="field"><span>Registration</span>
          <input id="m-reg" value="${U.esc(a?.registration || "")}" placeholder="HB-EZD" /></label>
        <label class="field"><span>ICAO24 hex</span>
          <input id="m-icao" value="${U.esc(a?.icao24 || "")}" placeholder="e.g. 4b1234" /></label>
        <label class="field"><span>Model / Type</span>
          <input id="m-model" value="${U.esc(a?.model || "")}" placeholder="Bristell B23-912iS" /></label>
        <div class="form-grid">
          <label class="field"><span>Nickname (optional)</span>
            <input id="m-nick" value="${U.esc(a?.nickname || "")}" /></label>
          <label class="field"><span>Track Color</span>
            <input id="m-color" type="color" value="${U.esc(a?.color || "#e63946")}" /></label>
        </div>
        <div class="flex flex-end row-gap">
          <button class="btn btn-ghost" id="m-cancel">Cancel</button>
          <button class="btn btn-primary" id="m-save">${isEdit ? "Save" : "Add"}</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelector("#m-cancel").onclick = close;

  backdrop.querySelector("#m-save").onclick = async () => {
    const payload = {
      registration: backdrop.querySelector("#m-reg").value.trim(),
      icao24: backdrop.querySelector("#m-icao").value.trim(),
      model: backdrop.querySelector("#m-model").value.trim(),
      nickname: backdrop.querySelector("#m-nick").value.trim(),
      color: backdrop.querySelector("#m-color").value,
    };
    if (!payload.registration) {
      U.toast("Registration is required.", "error");
      return;
    }
    try {
      if (isEdit) await API.updateAircraft(a.id, payload);
      else await API.createAircraft(payload);
      U.toast("Saved", "success");
      close();
      renderSettings();
    } catch (e) {
      U.toast(e.message, "error");
    }
  };
}

/* ---------------- Shared ---------------- */
function errorBox(msg) {
  return `<div class="empty">
    <div class="big">⚠</div>
    <div>${U.esc(msg)}</div>
    <a class="btn row-gap" href="#/flights">Back to flights</a>
  </div>`;
}

/* ---------------- Navbar clock (UTC + Zurich) ---------------- */
function startClock() {
  const utcEl = document.getElementById("clk-utc");
  const zrhEl = document.getElementById("clk-zrh");
  if (!utcEl || !zrhEl) return;

  const timeOpts = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false };
  // Intl handles the CET/CEST switchover for Europe/Zurich automatically.
  const utcFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...timeOpts });
  const zrhFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", ...timeOpts });

  const tick = () => {
    const now = new Date();
    utcEl.textContent = utcFmt.format(now);
    zrhEl.textContent = zrhFmt.format(now);
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- Theme (light / dark) ---------------- */
function applyTheme(theme) {
  const light = theme === "light";
  document.body.classList.toggle("light-mode", light);
  // There can be more than one toggle (navbar + mobile menu).
  document.querySelectorAll(".js-theme-icon").forEach((el) => {
    el.textContent = light ? "☀️" : "🌙";
  });
  document.querySelectorAll(".js-theme-toggle").forEach((btn) => {
    btn.setAttribute(
      "aria-label",
      light ? "Switch to dark mode" : "Switch to light mode"
    );
  });
}

function initTheme() {
  // Default to dark; honor saved preference.
  applyTheme(localStorage.getItem("theme") === "light" ? "light" : "dark");
  document.querySelectorAll(".js-theme-toggle").forEach((btn) => {
    btn.onclick = toggleTheme;
  });
}

function initLogout() {
  document.querySelectorAll(".js-logout").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.logout();
      } catch (_) {
        /* ignore — redirect regardless */
      }
      window.location.href = "/login";
    };
  });
}

/* ---------------- Mobile navigation menu ---------------- */
function initMobileMenu() {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("mobile-menu");
  if (!toggle || !menu) return;

  const close = () => {
    menu.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    menu.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.contains("open") ? close() : open();
  });

  // Tapping a nav item closes the menu (navigation happens via the hash).
  menu.querySelectorAll("a[data-nav]").forEach((a) =>
    a.addEventListener("click", close)
  );

  // Tapping outside the menu (and not on the toggle) closes it.
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("open")) return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });

  // Escape closes the menu.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function toggleTheme() {
  const next = document.body.classList.contains("light-mode") ? "dark" : "light";
  localStorage.setItem("theme", next);
  applyTheme(next);
  // Canvas/Leaflet content reads the theme at draw time, so rebuild views
  // that contain a map or charts to pick up the new palette.
  const hash = window.location.hash;
  if (
    /^#\/flights\/\d+$/.test(hash) ||
    hash === "#/stats" ||
    hash === "#/airports" ||
    hash === "#/heatmap"
  ) {
    router();
  }
}

/* ---------------- Boot ---------------- */
initTheme();
initLogout();
initMobileMenu();
loadBranding();
startClock();
router();
