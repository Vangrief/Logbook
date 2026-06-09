/* Formatting helpers and small DOM/UX utilities. */
const U = (() => {
  const pad = (n) => String(n).padStart(2, "0");

  function fmtDate(ts) {
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fmtDateTime(ts) {
    const d = new Date(ts * 1000);
    return `${fmtDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtTime(ts) {
    const d = new Date(ts * 1000);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
  }

  function num(v, digits = 0) {
    if (v === null || v === undefined) return "—";
    return Number(v).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  // Escape user-provided strings before inserting into innerHTML.
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* Gradient color along the track: green -> amber -> red.
     t in [0, 1]. */
  function gradientColor(t) {
    const lerp = (a, b, x) => Math.round(a + (b - a) * x);
    const green = [34, 197, 94];
    const amber = [245, 158, 11];
    const red = [239, 68, 68];
    let c;
    if (t < 0.5) {
      const x = t / 0.5;
      c = [0, 1, 2].map((i) => lerp(green[i], amber[i], x));
    } else {
      const x = (t - 0.5) / 0.5;
      c = [0, 1, 2].map((i) => lerp(amber[i], red[i], x));
    }
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  let toastTimer = null;
  function toast(message, type = "") {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast"; }, 3800);
  }

  // Build a DOM element from an HTML string.
  function html(str) {
    const t = document.createElement("template");
    t.innerHTML = str.trim();
    return t.content.firstElementChild;
  }

  return {
    fmtDate, fmtDateTime, fmtTime, fmtDuration, num, esc,
    gradientColor, toast, html,
  };
})();
