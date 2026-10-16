// All the timer logic lives in this hook, so the components only draw things.
//
// While running, the source of truth is `endAt` (a timestamp), not a counter
// we decrement, so the time stays right even when the browser delays ticks.

import { useCallback, useEffect, useRef, useState } from "react";
import { beaconSession, saveSession } from "./api.js";
import { localIso } from "./format.js";

const MIN_ABANDONED_MS = 60_000; // stopped sessions shorter than this aren't logged
const TICK_MS = 200;

export const DEFAULT_SETTINGS = { label: "general", workMin: 25, breakMin: 5, cycles: 4 };

// ---- Sound and notifications ----
let audio = null;

function ensureAudio() {
  // Browsers only allow sound after a click, so this runs from the Start button.
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!audio && Ctx) audio = new Ctx();
  if (audio?.state === "suspended") audio.resume();
}

function chime() {
  if (!audio) return;
  const t = audio.currentTime;
  [880, 660].forEach((freq, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = t + i * 0.28;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

function notify(text) {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification("Pomodoro", { body: text });
  }
}

// ---- The hook ----
export function usePomodoro({ onSaved }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [timer, setTimer] = useState({
    status: "idle", // "idle" | "running" | "paused"
    phase: "work",  // "work" | "break"
    cycle: 1,
    phaseMs: DEFAULT_SETTINGS.workMin * 60_000,
    endAt: 0,
    remainingMs: DEFAULT_SETTINGS.workMin * 60_000,
  });
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState({ text: "", error: false });

  // Things that don't need a re-render: the settings a run started with,
  // when the current work phase began, and whether it was already saved.
  const run = useRef({ settings: DEFAULT_SETTINGS, workStart: null, logged: false });
  const timerRef = useRef(timer);
  timerRef.current = timer;

  const remaining = timer.status === "running" ? timer.endAt - now : timer.remainingMs;

  // While idle, the clock previews whatever is typed in the Work box.
  useEffect(() => {
    if (timer.status !== "idle") return;
    const ms = (Number(settings.workMin) || 0) * 60_000;
    setTimer((t) => ({ ...t, phaseMs: ms, remainingMs: ms }));
  }, [settings.workMin, timer.status]);

  // Tick while running.
  useEffect(() => {
    if (timer.status !== "running") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    const onVisible = () => !document.hidden && setNow(Date.now()); // catch up on return
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timer.status]);

  const save = useCallback(
    async (record) => {
      try {
        await saveSession(record);
        onSaved?.();
      } catch (err) {
        setMessage({ text: `Couldn't save that session: ${err.message}. Is server.py running?`, error: true });
      }
    },
    [onSaved]
  );

  const buildRecord = (endDate, focusedMs, completed) => ({
    label: run.current.settings.label,
    start: localIso(run.current.workStart),
    end: localIso(endDate),
    minutes: Math.round((focusedMs / 60_000) * 100) / 100,
    completed,
  });

  const startPhase = useCallback((phase, cycle) => {
    const s = run.current.settings;
    const phaseMs = (phase === "work" ? s.workMin : s.breakMin) * 60_000;
    if (phase === "work") run.current = { ...run.current, workStart: new Date(), logged: false };
    const t = Date.now();
    setNow(t);
    setTimer({ status: "running", phase, cycle, phaseMs, endAt: t + phaseMs, remainingMs: phaseMs });
  }, []);

  const goIdle = useCallback(() => {
    const ms = run.current.settings.workMin * 60_000;
    setTimer({ status: "idle", phase: "work", cycle: 1, phaseMs: ms, endAt: 0, remainingMs: ms });
  }, []);

  // When a phase runs out: save work sessions, then move to the next phase.
  useEffect(() => {
    if (timer.status !== "running" || remaining > 0) return;
    const s = run.current.settings;
    chime();

    if (timer.phase === "work") {
      run.current.logged = true;
      // Use the scheduled end time, so a late tick doesn't stretch the session.
      save(buildRecord(new Date(timer.endAt), timer.phaseMs, true));
      if (timer.cycle >= s.cycles) {
        notify(`All ${s.cycles} sessions done.`);
        setMessage({ text: `Done! ${s.cycles} session${s.cycles > 1 ? "s" : ""} logged for ${s.label}.`, error: false });
        goIdle();
      } else {
        notify("Work session done. Time for a break.");
        setMessage({ text: "Session saved. Take a break.", error: false });
        startPhase("break", timer.cycle);
      }
    } else {
      notify("Break's over. Back to work.");
      setMessage({ text: "", error: false });
      startPhase("work", timer.cycle + 1);
    }
  }, [timer, remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focused time in the current work phase. Pausing freezes `remaining`,
  // so paused time is left out automatically.
  const focusedMs = (t = timerRef.current) =>
    t.phaseMs - Math.max(t.status === "running" ? t.endAt - Date.now() : t.remainingMs, 0);

  // ---- Actions for the buttons ----
  const startOrPause = useCallback(() => {
    ensureAudio();
    const t = timerRef.current;
    if (t.status === "idle") {
      const s = {
        label: settings.label.trim() || "general",
        workMin: Number(settings.workMin),
        breakMin: Number(settings.breakMin),
        cycles: Number(settings.cycles),
      };
      if (!(s.workMin > 0) || !(s.breakMin > 0)) {
        setMessage({ text: "Work and break need to be more than 0 minutes.", error: true });
        return;
      }
      if (!Number.isInteger(s.cycles) || s.cycles < 1) {
        setMessage({ text: "Cycles needs to be a whole number, 1 or more.", error: true });
        return;
      }
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
      run.current = { ...run.current, settings: s };
      setMessage({ text: "", error: false });
      startPhase("work", 1);
    } else if (t.status === "running") {
      setTimer({ ...t, status: "paused", remainingMs: Math.max(t.endAt - Date.now(), 0) });
    } else {
      const n = Date.now();
      setNow(n);
      setTimer({ ...t, status: "running", endAt: n + t.remainingMs });
    }
  }, [settings, startPhase]);

  const stop = useCallback(() => {
    const t = timerRef.current;
    if (t.phase === "work" && !run.current.logged) {
      const focused = focusedMs(t);
      if (focused >= MIN_ABANDONED_MS) {
        run.current.logged = true;
        save(buildRecord(new Date(), focused, false));
        setMessage({ text: `Stopped early. Logged ${(focused / 60_000).toFixed(1)} min as unfinished.`, error: false });
      } else {
        setMessage({ text: "Stopped early. Under a minute, so it wasn't logged.", error: false });
      }
    } else {
      setMessage({ text: "Stopped.", error: false });
    }
    goIdle();
  }, [save, goIdle]); // eslint-disable-line react-hooks/exhaustive-deps

  const skipBreak = useCallback(() => {
    const t = timerRef.current;
    if (t.phase !== "break") return;
    setMessage({ text: "", error: false });
    startPhase("work", t.cycle + 1);
  }, [startPhase]);

  // Closing the tab mid-session logs it like Ctrl+C does in the CLI.
  useEffect(() => {
    const onPageHide = () => {
      const t = timerRef.current;
      if (t.status === "idle" || t.phase !== "work" || run.current.logged) return;
      const focused = focusedMs(t);
      if (focused < MIN_ABANDONED_MS) return;
      beaconSession(buildRecord(new Date(), focused, false));
      run.current.logged = true;
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    settings,
    setSettings,
    runSettings: run.current.settings,
    ...timer,
    remaining: Math.max(remaining, 0),
    progress: timer.phaseMs ? Math.min(Math.max(remaining / timer.phaseMs, 0), 1) : 1,
    message,
    startOrPause,
    stop,
    skipBreak,
  };
}
