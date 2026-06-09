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
  { re: /^#\/settings$/, handler: renderSettings },
];

function router() {
  const hash = window.location.hash || "#/flights";
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
    : hash.startsWith("#/settings")
    ? "settings"
    : "flights";
  document.querySelectorAll(".nav a").forEach((a) =>
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
    flights.forEach((f) => listEl.appendChild(flightRow(f)));
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

function flightRow(f) {
  const color = f.color || "#f59e0b";
  const title = f.nickname || f.registration || "Unknown";
  const notes = f.notes ? U.esc(f.notes) : `<span class="muted">No notes</span>`;
  const row = U.html(`
    <div class="card flight-row">
      <div class="tail">
        <span class="dot" style="color:${U.esc(color)};background:${U.esc(color)}"></span>
        <span>${U.esc(f.registration || "—")}</span>
      </div>
      <div class="meta">
        <div class="date">${U.fmtDate(f.start_time)} · ${U.fmtTime(f.start_time)}–${U.fmtTime(f.end_time)}
          ${f.callsign ? `· ${U.esc(f.callsign)}` : ""}</div>
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
        <button class="btn btn-danger" id="del-flight">Delete</button>
      </div>
    </div>

    <div class="detail-grid">
      <div id="map"></div>

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

  drawMap(f);
  drawAltChart(f);
}

function statTile(label, value, unit) {
  return `<div class="stat-tile">
    <div class="label">${label}</div>
    <div class="value">${value}<span class="unit">${unit}</span></div>
  </div>`;
}

/* ---- Leaflet map with gradient track ---- */
let mapInstance = null;
function drawMap(f) {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }

  const path = (f.track || []).filter(
    (p) => p[1] !== null && p[2] !== null
  );
  const map = L.map("map", { zoomControl: true, attributionControl: true });
  mapInstance = map;

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
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

  // Gradient: one short polyline per segment, colored green->amber->red.
  const latlngs = path.map((p) => [p[1], p[2]]);
  for (let i = 0; i < latlngs.length - 1; i++) {
    const t = i / (latlngs.length - 1);
    L.polyline([latlngs[i], latlngs[i + 1]], {
      color: U.gradientColor(t),
      weight: 4,
      opacity: 0.95,
      lineCap: "round",
    }).addTo(map);
  }

  // Takeoff / landing markers.
  const mk = (latlng, color, label) =>
    L.circleMarker(latlng, {
      radius: 7,
      color: "#0a0e1a",
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip(label, { permanent: false, direction: "top" });

  mk(latlngs[0], "#22c55e", "Takeoff");
  mk(latlngs[latlngs.length - 1], "#ef4444", "Landing");

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

  const ctx = document.getElementById("alt-chart").getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, "rgba(245, 158, 11, 0.35)");
  grad.addColorStop(1, "rgba(245, 158, 11, 0.02)");

  altChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          data: points,
          borderColor: "#f59e0b",
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
          backgroundColor: "#161f33",
          borderColor: "#243049",
          borderWidth: 1,
          titleColor: "#94a3b8",
          bodyColor: "#e5ecf6",
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
          title: { display: true, text: "minutes", color: "#5b6b85" },
          ticks: { color: "#5b6b85", font: { family: "JetBrains Mono", size: 10 } },
          grid: { color: "rgba(36,48,73,0.5)" },
        },
        y: {
          title: { display: true, text: "feet", color: "#5b6b85" },
          ticks: { color: "#5b6b85", font: { family: "JetBrains Mono", size: 10 } },
          grid: { color: "rgba(36,48,73,0.5)" },
        },
      },
    },
  });
}

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

async function runDiscovery() {
  const box = document.getElementById("discovery");
  if (!box) return;

  const aircraftId = Number(document.getElementById("n-aircraft").value);
  const ts = newFormTimestamp();
  if (!aircraftId || ts === null) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = `<div class="card panel"><div class="empty" style="padding:36px">
    <span class="spinner"></span>
    <div style="margin-top:12px">Searching OpenSky for flights ±6 h…</div>
  </div></div>`;

  try {
    const flights = await API.discoverFlights({ aircraft_id: aircraftId, time: ts });
    drawDiscovery(flights, ts, aircraftId);
  } catch (e) {
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
            <input id="m-color" type="color" value="${U.esc(a?.color || "#f59e0b")}" /></label>
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

/* ---------------- Boot ---------------- */
loadBranding();
startClock();
router();
