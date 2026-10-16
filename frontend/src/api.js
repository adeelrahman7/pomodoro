// Tiny wrapper around server.py's JSON API.

async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server replied ${res.status}`);
  return body;
}

export const getSummary = (week = 0) => request(`/api/summary?week=${week}`);
export const getRecent = (n = 8) => request(`/api/sessions?n=${n}`);

export const saveSession = (record) =>
  request("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });

// For when the tab is closing: sendBeacon still gets delivered after the page is gone.
export const beaconSession = (record) =>
  navigator.sendBeacon(
    "/api/sessions",
    new Blob([JSON.stringify(record)], { type: "application/json" })
  );
