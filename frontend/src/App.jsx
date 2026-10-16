import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FlipCard from "./components/FlipCard.jsx";
import StatsSidebar from "./components/StatsSidebar.jsx";
import { usePomodoro } from "./usePomodoro.js";
import { getRecent } from "./api.js";
import { splitClock } from "./format.js";

const SIDEBAR_KEY = "pomodoro.sidebarOpen";

// localStorage can throw in private windows, so every access is wrapped.
function readSidebarPref() {
  try { return localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { return false; }
}
function writeSidebarPref(open) {
  try { localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0"); } catch { /* ignore */ }
}

/** True after `ms` without mouse/keyboard/touch activity. Used to fade the controls. */
function useIdle(ms, enabled) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) { setIdle(false); return; }
    let id;
    const wake = () => {
      setIdle(false);
      clearTimeout(id);
      id = setTimeout(() => setIdle(true), ms);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, wake));
    wake();
    return () => {
      clearTimeout(id);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [ms, enabled]);
  return idle;
}

function StatsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="2" y="9" width="3" height="7" rx="1" fill="currentColor" />
      <rect x="7.5" y="4" width="3" height="12" rx="1" fill="currentColor" />
      <rect x="13" y="7" width="3" height="9" rx="1" fill="currentColor" />
    </svg>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarPref);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pastLabels, setPastLabels] = useState([]);

  const onSaved = useCallback(() => setRefreshKey((k) => k + 1), []);
  const p = usePomodoro({ onSaved });
  const active = p.status !== "idle";
  const quiet = useIdle(3000, p.status === "running");

  // Past labels become suggestions in the "Working on" box.
  useEffect(() => {
    getRecent(30)
      .then((rows) => setPastLabels([...new Set(rows.map((r) => r.label))]))
      .catch(() => {});
  }, [refreshKey]);

  const toggleSidebar = useCallback((open) => {
    setSidebarOpen((prev) => {
      const next = typeof open === "boolean" ? open : !prev;
      writeSidebarPref(next);
      return next;
    });
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  // Keyboard: Space = start/pause, S = stats, F = fullscreen, Esc = close stats.
  useEffect(() => {
    const onKey = (e) => {
      const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if (e.key === "Escape") return toggleSidebar(false);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space" && document.activeElement?.tagName !== "BUTTON") {
        e.preventDefault();
        p.startOrPause();
      } else if (e.key === "s" || e.key === "S") {
        toggleSidebar();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.startOrPause, toggleSidebar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab title shows the countdown, so you can see it from other tabs.
  const { minutes, seconds } = splitClock(p.remaining);
  useEffect(() => {
    document.title = active
      ? `${minutes}:${seconds} ${p.phase === "work" ? p.runSettings.label : "Break"}`
      : "Pomodoro";
  }, [active, minutes, seconds, p.phase, p.runSettings.label]);

  const cycles = active ? p.runSettings.cycles : Number(p.settings.cycles) || 1;
  const statusText = !active
    ? "Ready when you are"
    : `${p.phase === "work" ? `Working on ${p.runSettings.label}` : "Break"}, cycle ${p.cycle} of ${cycles}` +
      (p.status === "paused" ? " (paused)" : "");

  const set = (field) => (e) => p.setSettings((s) => ({ ...s, [field]: e.target.value }));

  return (
    <div
      className="app"
      data-phase={p.phase}
      data-status={p.status}
      data-sidebar={sidebarOpen ? "open" : "closed"}
      data-quiet={quiet ? "true" : "false"}
    >
      <main className="stage">
        <div className="topbar fade-when-quiet">
          <span className="phase-chip">
            <span className="dot" aria-hidden="true" />
            {p.phase === "work" ? "Focus" : "Break"}
          </span>
          <div className="topbar-actions">
            <button type="button" className="ghost-btn" onClick={toggleFullscreen} aria-label="Toggle full screen" title="Full screen (F)">
              ⛶
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => toggleSidebar()}
              aria-expanded={sidebarOpen}
              aria-controls="stats"
              title="Statistics (S)"
            >
              <StatsIcon /> <span>Stats</span>
            </button>
          </div>
        </div>

        <div className="clock-wrap">
          <div className="clock" role="timer" aria-live="off">
            <FlipCard value={minutes} label={`${Number(minutes)} minutes`} />
            <FlipCard value={seconds} label={`${Number(seconds)} seconds`} corner={`${p.cycle}/${cycles}`} />
          </div>
        </div>

        <div className="dock">
          <p className="status" aria-live="polite">{statusText}</p>

          <AnimatePresence initial={false}>
            {!active && (
              <motion.form
                key="settings"
                className="settings"
                autoComplete="off"
                onSubmit={(e) => { e.preventDefault(); p.startOrPause(); }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
              >
                <label className="field field-wide">
                  <span>Working on</span>
                  <input value={p.settings.label} onChange={set("label")} maxLength={40} list="past-labels" />
                  <datalist id="past-labels">
                    {pastLabels.map((l) => <option key={l} value={l} />)}
                  </datalist>
                </label>
                <label className="field">
                  <span>Work</span>
                  <input type="number" min="0.1" max="180" step="any" value={p.settings.workMin} onChange={set("workMin")} />
                </label>
                <label className="field">
                  <span>Break</span>
                  <input type="number" min="0.1" max="60" step="any" value={p.settings.breakMin} onChange={set("breakMin")} />
                </label>
                <label className="field">
                  <span>Cycles</span>
                  <input type="number" min="1" max="12" step="1" value={p.settings.cycles} onChange={set("cycles")} />
                </label>
                {/* lets Enter in any box start the timer */}
                <button type="submit" hidden />
              </motion.form>
            )}
          </AnimatePresence>

          <div className="controls">
            <button type="button" className="btn btn-primary" onClick={p.startOrPause}>
              {p.status === "running" ? "Pause" : p.status === "paused" ? "Resume" : "Start"}
            </button>
            {active && p.phase === "break" && (
              <button type="button" className="btn" onClick={p.skipBreak}>Skip break</button>
            )}
            {active && (
              <button type="button" className="btn" onClick={p.stop}>Stop</button>
            )}
          </div>
          <p className={`message${p.message.error ? " error" : ""}`} role="status">{p.message.text}</p>
        </div>

        {/* Thin bar along the bottom: how much of this phase is left */}
        <div className="progress" aria-hidden="true">
          <motion.div
            className="progress-fill"
            animate={{ scaleX: p.progress }}
            transition={{ duration: 0.25, ease: "linear" }}
          />
        </div>
      </main>

      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              key="backdrop"
              className="backdrop"
              onClick={() => toggleSidebar(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <StatsSidebar key="sidebar" onClose={() => toggleSidebar(false)} refreshKey={refreshKey} />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
