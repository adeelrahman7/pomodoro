// Formatting helpers shared by the components.

const pad = (n) => String(n).padStart(2, "0");

/** Milliseconds -> { minutes: "24", seconds: "07" }, rounding partial seconds up. */
export function splitClock(ms) {
  const total = Math.ceil(Math.max(ms, 0) / 1000);
  return { minutes: pad(Math.floor(total / 60)), seconds: pad(total % 60) };
}

/** 65.5 -> "1h 06m", 25 -> "25m" (same as format_minutes in summary.py). */
export function formatMinutes(minutes) {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  return h ? `${h}h ${pad(total % 60)}m` : `${total % 60}m`;
}

/** Local time as "2026-10-16T09:30:00", the same format the CLI writes. */
export function localIso(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
