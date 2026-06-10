/* Thin fetch wrapper around the backend JSON API. */
const API = (() => {
  async function request(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);

    // Session expired or missing — drop back to the login page. Guard against
    // a redirect loop: never bounce when we're already on the login page.
    if (res.status === 401) {
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      throw new Error("Authentication required");
    }
    if (res.status === 204) return null;

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = text; }
    }
    if (!res.ok) {
      const detail =
        (data && data.detail) || (typeof data === "string" && data) ||
        `Request failed (${res.status})`;
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    // Aircraft
    listAircraft: () => request("GET", "/api/aircraft"),
    createAircraft: (a) => request("POST", "/api/aircraft", a),
    updateAircraft: (id, a) => request("PUT", `/api/aircraft/${id}`, a),
    deleteAircraft: (id) => request("DELETE", `/api/aircraft/${id}`),

    // Flights
    listFlights: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")
      ).toString();
      return request("GET", `/api/flights${qs ? "?" + qs : ""}`);
    },
    discoverFlights: ({ aircraft_id, time, window }) => {
      const params = { aircraft_id, time };
      if (window) params.window = window;
      const qs = new URLSearchParams(params).toString();
      return request("GET", `/api/flights/discover?${qs}`);
    },
    createFlight: (f) => request("POST", "/api/flights", f),
    getFlight: (id) => request("GET", `/api/flights/${id}`),
    patchFlight: (id, body) => request("PATCH", `/api/flights/${id}`, body),
    updateNotes: (id, notes) => request("PUT", `/api/flights/${id}/notes`, { notes }),
    deleteFlight: (id) => request("DELETE", `/api/flights/${id}`),

    // Live tracking — returns null (204) when no fresh state is available.
    getLive: (icao24) => request("GET", `/api/live/${icao24}`),

    // Settings
    getSettings: () => request("GET", "/api/settings"),
    updateSettings: (s) => request("PUT", "/api/settings", s),

    // Stats
    getStats: () => request("GET", "/api/stats"),

    // Airports
    getAirports: () => request("GET", "/api/airports"),

    // Heatmap
    getHeatmap: (aircraftId) =>
      request("GET", `/api/heatmap${aircraftId ? `?aircraft_id=${aircraftId}` : ""}`),

    // Auth — logout uses a plain fetch so it is never caught by the 401
    // intercept above (which would otherwise risk a redirect loop).
    logout: () => fetch("/api/logout", { method: "POST" }),
  };
})();
