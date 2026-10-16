// Pomodoro web UI.
//
// The countdown runs here in the browser. When a work phase ends (or you stop
// one after at least a minute), the session is POSTed to server.py, which
// appends it to sessions.json, the same file the CLI uses.

"use strict";

const MIN_ABANDONED_MS = 60_000; // stopped sessions shorter than this aren't logged
const TICK_MS = 250;

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);
const els = {
  clock: $("clock"), phase: $("phase-text"), wedge: $("wedge"), ticks: $("ticks"),
  label: $("label"), work: $("work"), brk: $("break"), cycles: $("cycles"),
  start: $("start-btn"), skip: $("skip-btn"), stop: $("stop-btn"), message: $("message"),
  pastLabels: $("past-labels"),
  weekHeading: $("week-heading"), weekRange: $("week-range"),
  prevWeek: $("prev-week"), nextWeek: $("next-week"),
  total: $("total"), tally: $("tally"), days: $("days"), labels: $("labels"), recent: $("recent"),
};

// ---------- Timer state ----------
// status: "idle" | "running" | "paused"
// While running, the source of truth is endAt (a timestamp), not a counter,
// so the time stays right even if the browser delays our ticks.
const state = {
  status: "idle",
  phase: "work",       // "work" | "break"
  cycle: 1,
  settings: null,      // { label, workMin, breakMin, cycles } captured at Start
  phaseMs: 0,          // full length of the current phase
  endAt: 0,            // when the phase ends (only meaningful while running)
  remainingMs: 0,      // time left (kept up to date while paused)
  workStart: null,     // Date the current work phase began
  logged: false,       // whether the current work phase was already saved
};
let tickTimer = null;
let audio = null;
let weekOffset = 0;

// ---------- Small helpers ----------
function formatClock(ms) {
  const total = Math.ceil(Math.max(ms, 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatMinutes(minutes) {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// Local time as "2026-10-16T09:30:00", the same format the CLI writes.
function localIso(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
         `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function remaining() {
  return state.status === "running" ? state.endAt - Date.now() : state.remainingMs;
}

function showMessage(text, isError = false) {
  els.message.textContent = text;
  els.message.classList.toggle("error", isError);
}

// ---------- The dial ----------
const CX = 100, CY = 100, R = 82;

// One tick per minute of the phase (so the ticks mean something), up to 60.
function drawTicks(phaseMinutes) {
  const whole = Number.isInteger(phaseMinutes) && phaseMinutes >= 1 && phaseMinutes <= 60;
  const count = whole ? phaseMinutes : 12;
  const majorEvery = whole && count > 12 ? 5 : 1;
  let svg = "";
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 2 * Math.PI;
    const major = i % majorEvery === 0;
    const r1 = major ? 85 : 88, r2 = 93;
    const x1 = CX + r1 * Math.sin(a), y1 = CY - r1 * Math.cos(a);
    const x2 = CX + r2 * Math.sin(a), y2 = CY - r2 * Math.cos(a);
    svg += `<line class="tick${major ? " tick-major" : ""}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }
  els.ticks.innerHTML = svg;
}

// Draw a pie wedge from 12 o'clock covering `fraction` of the circle.
function drawWedge(fraction) {
  const f = Math.min(Math.max(fraction, 0), 1);
  if (f >= 0.9999) {
    els.wedge.setAttribute("d", `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`);
    return;
  }
  if (f <= 0) { els.wedge.setAttribute("d", ""); return; }
  const a = f * 2 * Math.PI;
  const x = CX + R * Math.sin(a), y = CY - R * Math.cos(a);
  const large = f > 0.5 ? 1 : 0;
  els.wedge.setAttribute("d",
    `M ${CX} ${CY} L ${CX} ${CY - R} A ${R} ${R} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`);
}

// ---------- Rendering ----------
function render() {
  const left = remaining();
  const s = state.settings;
  document.body.dataset.phase = state.phase;
  document.body.dataset.status = state.status;

  els.clock.textContent = formatClock(left);
  drawWedge(state.phaseMs ? left / state.phaseMs : 1);

  if (state.status === "idle") {
    els.phase.textContent = "Ready when you are.";
    document.title = "Pomodoro";
  } else {
    const what = state.phase === "work" ? `Work on ${s.label}` : "Break";
    const paused = state.status === "paused" ? " (paused)" : "";
    els.phase.textContent = `${what}, cycle ${state.cycle} of ${s.cycles}${paused}`;
    document.title = `${formatClock(left)} ${state.phase === "work" ? s.label : "Break"}`;
  }

  const active = state.status !== "idle";
  els.start.textContent = state.status === "running" ? "Pause"
                        : state.status === "paused" ? "Resume" : "Start";
  els.stop.hidden = !active;
  els.skip.hidden = !(active && state.phase === "break");
  for (const input of [els.label, els.work, els.brk, els.cycles]) input.disabled = active;
}

// Show the idle dial for whatever is typed in the Work box.
function renderIdlePreview() {
  const workMin = Number(els.work.value) || 25;
  state.phaseMs = workMin * 60_000;
  state.remainingMs = state.phaseMs;
  drawTicks(workMin);
  render();
}

// ---------- Sound and notifications ----------
function ensureAudio() {
  // Browsers only allow audio after a click, so this runs from the Start button.
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audio = new Ctx();
  }
  if (audio && audio.state === "suspended") audio.resume();
}

function chime() {
  if (!audio) return;
  const now = audio.currentTime;
  [0, 0.28].forEach((offset, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = i === 0 ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.3);
  });
}

function notify(text) {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification("Pomodoro", { body: text });
  }
}

// ---------- Saving sessions ----------
function buildRecord(endDate, focusedMs, completed) {
  return {
    label: state.settings.label,
    start: localIso(state.workStart),
    end: localIso(endDate),
    minutes: Math.round((focusedMs / 60_000) * 100) / 100,
    completed,
  };
}

async function saveSession(record) {
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Server replied ${res.status}`);
    }
    loadStats();
    return true;
  } catch (err) {
    showMessage(`Couldn't save that session: ${err.message}. Is server.py still running?`, true);
    return false;
  }
}

// ---------- Phase control ----------
function startPhase(phase) {
  const s = state.settings;
  state.phase = phase;
  state.phaseMs = (phase === "work" ? s.workMin : s.breakMin) * 60_000;
  state.endAt = Date.now() + state.phaseMs;
  state.remainingMs = state.phaseMs;
  state.status = "running";
  if (phase === "work") {
    state.workStart = new Date();
    state.logged = false;
  }
  drawTicks(phase === "work" ? s.workMin : s.breakMin);
  startTicking();
  render();
}

function finishPhase() {
  const s = state.settings;
  chime();

  if (state.phase === "work") {
    // Use the scheduled end time, so a late tick doesn't stretch the session.
    const end = new Date(state.endAt);
    state.logged = true;
    saveSession(buildRecord(end, state.phaseMs, true));

    if (state.cycle >= s.cycles) {
      notify(`All ${s.cycles} sessions done.`);
      showMessage(`Done! ${s.cycles} work session${s.cycles > 1 ? "s" : ""} logged for ${s.label}.`);
      resetToIdle();
      return;
    }
    notify("Work session done. Time for a break.");
    showMessage("Session saved. Take a break.");
    startPhase("break");
  } else {
    notify("Break's over. Back to work.");
    showMessage("");
    state.cycle += 1;
    startPhase("work");
  }
}

function tick() {
  if (state.status !== "running") return;
  if (remaining() <= 0) finishPhase();
  else render();
}

function startTicking() {
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, TICK_MS);
}

function resetToIdle() {
  clearInterval(tickTimer);
  state.status = "idle";
  state.phase = "work";
  state.cycle = 1;
  renderIdlePreview();
}

function readSettings() {
  const label = els.label.value.trim() || "general";
  const workMin = Number(els.work.value);
  const breakMin = Number(els.brk.value);
  const cycles = Number(els.cycles.value);
  if (!(workMin > 0) || !(breakMin > 0)) return "Work and break need to be more than 0 minutes.";
  if (!Number.isInteger(cycles) || cycles < 1) return "Cycles needs to be a whole number, 1 or more.";
  return { label, workMin, breakMin, cycles };
}

function onStartPause() {
  ensureAudio();
  if (state.status === "idle") {
    const settings = readSettings();
    if (typeof settings === "string") { showMessage(settings, true); return; }
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    state.settings = settings;
    state.cycle = 1;
    showMessage("");
    startPhase("work");
  } else if (state.status === "running") {
    state.remainingMs = remaining();
    state.status = "paused";
    clearInterval(tickTimer);
    render();
  } else {
    state.endAt = Date.now() + state.remainingMs;
    state.status = "running";
    startTicking();
    render();
  }
}

// Focused time in the current work phase. Pauses freeze `remaining`,
// so this leaves paused time out automatically.
function focusedMs() {
  return state.phaseMs - Math.max(remaining(), 0);
}

function onStop() {
  if (state.phase === "work" && !state.logged) {
    const focused = focusedMs();
    if (focused >= MIN_ABANDONED_MS) {
      state.logged = true;
      saveSession(buildRecord(new Date(), focused, false));
      showMessage(`Stopped early. Logged ${(focused / 60_000).toFixed(1)} min as unfinished.`);
    } else {
      showMessage("Stopped early. Under a minute, so it wasn't logged.");
    }
  } else {
    showMessage("Stopped.");
  }
  resetToIdle();
}

function onSkipBreak() {
  if (state.phase !== "break") return;
  state.cycle += 1;
  showMessage("");
  startPhase("work");
}

// If the tab closes mid-session, still log the partial session, like Ctrl+C
// in the CLI. sendBeacon is built to survive the page going away.
window.addEventListener("pagehide", () => {
  if (state.status === "idle" || state.phase !== "work" || state.logged) return;
  const focused = focusedMs();
  if (focused < MIN_ABANDONED_MS) return;
  const blob = new Blob([JSON.stringify(buildRecord(new Date(), focused, false))],
                        { type: "application/json" });
  navigator.sendBeacon("/api/sessions", blob);
  state.logged = true;
});

// Catch up right away when you come back to the tab.
document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

// ---------- Weekly stats ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatRange(mondayIso, sundayIso) {
  const opts = { month: "short", day: "numeric" };
  const mon = new Date(mondayIso + "T00:00:00");
  const sun = new Date(sundayIso + "T00:00:00");
  return `${mon.toLocaleDateString(undefined, opts)} to ${sun.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
}

function renderSummary(data) {
  els.weekHeading.textContent = weekOffset === 0 ? "This week"
                              : weekOffset === -1 ? "Last week"
                              : `${-weekOffset} weeks ago`;
  els.weekRange.textContent = formatRange(data.monday, data.sunday);
  els.nextWeek.disabled = weekOffset >= 0;

  els.total.textContent = `${formatMinutes(data.total_minutes)} focused`;
  const parts = [`${data.completed} finished`];
  if (data.abandoned) parts.push(`${data.abandoned} stopped early`);
  parts.push(`${data.streak}-day streak`);
  els.tally.textContent = parts.join(", ");

  // Per-day bars
  const todayIso = localIso(new Date()).slice(0, 10);
  const peak = Math.max(...data.per_day.map((d) => d.minutes), 0);
  els.days.replaceChildren(...data.per_day.map((d) => {
    const col = el("div", "day" + (d.date === todayIso ? " today" : ""));
    const track = el("div", "day-track");
    const bar = el("div", "day-bar" + (d.minutes > 0 ? " has-time" : ""));
    bar.style.height = peak > 0 && d.minutes > 0 ? `${Math.max(4, (d.minutes / peak) * 100)}%` : "2px";
    bar.title = `${d.day}: ${formatMinutes(d.minutes)}`;
    track.append(bar);
    // "1h15m" without the space so it fits above a narrow bar on phones.
    const label = d.minutes ? formatMinutes(d.minutes).replace(" ", "") : "";
    col.append(el("span", "day-mins", label), track, el("span", "", d.day));
    return col;
  }));
  els.days.setAttribute("aria-label", "Focus minutes per day: " +
    data.per_day.map((d) => `${d.day} ${formatMinutes(d.minutes)}`).join(", "));

  // Per-label bars
  if (!data.per_label.length) {
    els.labels.replaceChildren(el("li", "empty",
      weekOffset === 0 ? "Nothing yet this week. Start a session to see it here." : "No sessions that week."));
  } else {
    const top = data.per_label[0].minutes;
    els.labels.replaceChildren(...data.per_label.map((l) => {
      const li = el("li");
      const barWrap = el("div", "label-bar");
      const fill = el("span");
      fill.style.width = `${(l.minutes / top) * 100}%`;
      barWrap.append(fill);
      li.append(el("span", "label-name", l.label), el("span", "label-mins", formatMinutes(l.minutes)), barWrap);
      return li;
    }));
  }
}

function renderRecent(sessions) {
  if (!sessions.length) {
    els.recent.replaceChildren(el("li", "empty", "Your sessions will show up here."));
    return;
  }
  els.recent.replaceChildren(...sessions.map((s) => {
    const start = new Date(s.start);
    const when = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
                 ", " + start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const li = el("li");
    const left = el("div");
    left.append(el("div", "", s.label), el("div", "when", when));
    const right = el("div", "mins");
    right.append(el("div", "", formatMinutes(s.minutes)));
    if (!s.completed) right.append(el("div", "stopped", "stopped early"));
    li.append(left, right);
    return li;
  }));

  // Offer past labels as suggestions in the "Working on" box.
  const labels = [...new Set(sessions.map((s) => s.label))];
  els.pastLabels.replaceChildren(...labels.map((l) => { const o = el("option"); o.value = l; return o; }));
}

async function loadStats() {
  try {
    const [summary, recent] = await Promise.all([
      fetch(`/api/summary?week=${weekOffset}`).then((r) => r.json()),
      fetch("/api/sessions?n=8").then((r) => r.json()),
    ]);
    renderSummary(summary);
    renderRecent(recent);
  } catch {
    showMessage("Couldn't load your stats. Start the server with: python server.py", true);
  }
}

// ---------- Wire it up ----------
els.start.addEventListener("click", onStartPause);
els.stop.addEventListener("click", onStop);
els.skip.addEventListener("click", onSkipBreak);
els.work.addEventListener("input", () => { if (state.status === "idle") renderIdlePreview(); });
els.prevWeek.addEventListener("click", () => { weekOffset -= 1; loadStats(); });
els.nextWeek.addEventListener("click", () => { if (weekOffset < 0) { weekOffset += 1; loadStats(); } });
$("settings").addEventListener("submit", (e) => { e.preventDefault(); onStartPause(); });

// Space bar starts or pauses, unless you're typing in a box.
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !["INPUT", "BUTTON"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    onStartPause();
  }
});

renderIdlePreview();
loadStats();
