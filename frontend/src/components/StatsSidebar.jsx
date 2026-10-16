// The weekly stats, in a panel that slides in from the right.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getRecent, getSummary } from "../api.js";
import { formatMinutes, localIso } from "../format.js";

function weekTitle(offset) {
  if (offset === 0) return "This week";
  if (offset === -1) return "Last week";
  return `${-offset} weeks ago`;
}

function formatRange(mondayIso, sundayIso) {
  const opts = { month: "short", day: "numeric" };
  const mon = new Date(`${mondayIso}T00:00:00`).toLocaleDateString(undefined, opts);
  const sun = new Date(`${sundayIso}T00:00:00`).toLocaleDateString(undefined, { ...opts, year: "numeric" });
  return `${mon} to ${sun}`;
}

function formatWhen(iso) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

export default function StatsSidebar({ onClose, refreshKey }) {
  const [week, setWeek] = useState(0);
  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSummary(week), getRecent(8)])
      .then(([s, r]) => {
        if (cancelled) return;
        setSummary(s);
        setRecent(r);
        setError("");
      })
      .catch(() => !cancelled && setError("Couldn't load your stats. Is server.py running?"));
    return () => { cancelled = true; };
  }, [week, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = localIso(new Date()).slice(0, 10);
  const peak = summary ? Math.max(...summary.per_day.map((d) => d.minutes), 0) : 0;
  const topLabel = summary?.per_label[0]?.minutes || 0;

  return (
    <motion.aside
      id="stats"
      className="sidebar"
      aria-label="Statistics"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
    >
      <header className="sidebar-head">
        <div>
          <h2>{weekTitle(week)}</h2>
          {summary && <p className="muted">{formatRange(summary.monday, summary.sunday)}</p>}
        </div>
        <div className="sidebar-actions">
          <button type="button" className="icon-btn" onClick={() => setWeek((w) => w - 1)} aria-label="Previous week">‹</button>
          <button type="button" className="icon-btn" onClick={() => setWeek((w) => w + 1)} disabled={week >= 0} aria-label="Next week">›</button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close statistics">×</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {summary && (
        <>
          <p className="total">{formatMinutes(summary.total_minutes)} focused</p>
          <p className="muted">
            {summary.completed} finished
            {summary.abandoned ? `, ${summary.abandoned} stopped early` : ""}
            , {summary.streak}-day streak
          </p>

          <div
            className="days"
            role="img"
            aria-label={"Focus minutes per day: " + summary.per_day.map((d) => `${d.day} ${formatMinutes(d.minutes)}`).join(", ")}
          >
            {summary.per_day.map((d, i) => (
              <div key={d.date} className={`day${d.date === today ? " today" : ""}`}>
                <span className="day-mins">{d.minutes ? formatMinutes(d.minutes).replace(" ", "") : ""}</span>
                <div className="day-track">
                  <motion.div
                    className={`day-bar${d.minutes ? " has-time" : ""}`}
                    initial={{ height: 0 }}
                    animate={{ height: peak && d.minutes ? `${Math.max(4, (d.minutes / peak) * 100)}%` : 2 }}
                    transition={{ delay: 0.15 + i * 0.04, type: "spring", stiffness: 260, damping: 26 }}
                  />
                </div>
                <span>{d.day}</span>
              </div>
            ))}
          </div>

          <h3>By label</h3>
          {summary.per_label.length === 0 ? (
            <p className="muted">{week === 0 ? "Nothing yet this week. Start a session to see it here." : "No sessions that week."}</p>
          ) : (
            <ul className="labels">
              {summary.per_label.map((l) => (
                <li key={l.label}>
                  <span className="label-name">{l.label}</span>
                  <span className="muted">{formatMinutes(l.minutes)}</span>
                  <div className="label-track">
                    <motion.span
                      initial={{ width: 0 }}
                      animate={{ width: `${(l.minutes / topLabel) * 100}%` }}
                      transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3>Recent sessions</h3>
          {recent.length === 0 ? (
            <p className="muted">Your sessions will show up here.</p>
          ) : (
            <ol className="recent">
              {recent.map((s) => (
                <li key={s.start + s.label}>
                  <div>
                    <div>{s.label}</div>
                    <div className="muted small">{formatWhen(s.start)}</div>
                  </div>
                  <div className="recent-mins">
                    <div>{formatMinutes(s.minutes)}</div>
                    {!s.completed && <div className="muted small">stopped early</div>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </motion.aside>
  );
}
