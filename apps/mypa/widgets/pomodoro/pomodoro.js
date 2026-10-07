const $ = (id) => document.getElementById(id);
const CIRC = 2 * Math.PI * 44;
$("arc").style.strokeDasharray = String(CIRC);

// state: { phase, endsAt (ms, when running), remaining (ms, when paused), day, done, streak }
// `streak` counts focus sessions since the last long break.
let state = { phase: "focus", endsAt: null, remaining: null, day: "", done: 0, streak: 0 };
let tick = null;

const num = (key, fallback) => Number(mypa.settings[key]) || fallback;
const every = () => Math.max(2, num("longEvery", 4));
const minutes = (phase) =>
  (phase === "focus" ? num("work", 25) : phase === "long" ? num("longRest", 15) : num("rest", 5)) *
  60_000;

/** Local calendar day — the count resets at your midnight, not UTC's. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const left = () =>
  state.endsAt ? Math.max(0, state.endsAt - Date.now()) : (state.remaining ?? minutes(state.phase));

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const LABEL = { focus: "Focus", rest: "Short break", long: "Long break" };

function render() {
  const remaining = left();
  const running = Boolean(state.endsAt);
  $("time").textContent = fmt(remaining);
  $("phase").textContent = LABEL[state.phase];
  $("phase").dataset.phase = state.phase;
  $("arc").dataset.phase = state.phase;
  $("arc").style.strokeDashoffset = String(CIRC * (1 - remaining / minutes(state.phase)));
  $("toggle").textContent = running ? "Pause" : state.remaining ? "Resume" : "Start";
  $("toggle").setAttribute("aria-label", `${$("toggle").textContent} timer`);
  $("skip").textContent = state.phase === "focus" ? "Skip to break" : "Skip break";
  $("reset").disabled = !running && !state.remaining && state.phase === "focus";
  document.body.dataset.running = String(running);

  // progress toward the long break
  const dots = $("dots");
  const n = every();
  if (dots.childElementCount !== n) {
    dots.replaceChildren(...Array.from({ length: n }, () => document.createElement("span")));
  }
  const filled = state.phase === "long" ? n : state.streak % n;
  [...dots.children].forEach((d, i) => d.classList.toggle("on", i < filled));
  dots.setAttribute("aria-label", `${filled} of ${n} sessions until a long break`);

  const done = state.day === today() ? state.done : 0;
  $("count").textContent = done
    ? `${done} session${done === 1 ? "" : "s"} today`
    : "No sessions yet today";
}

const persist = () => mypa.storage.set("state", state);

/** Moves to the next phase. `completed` = the timer ran out (vs. skipped). */
async function advance(completed) {
  const wasFocus = state.phase === "focus";
  if (wasFocus && completed) {
    if (state.day !== today()) {
      state.day = today();
      state.done = 0;
    }
    state.done += 1;
  }
  if (wasFocus) {
    state.streak += 1;
    state.phase = state.streak % every() === 0 ? "long" : "rest";
  } else {
    if (state.phase === "long") state.streak = 0;
    state.phase = "focus";
  }
  state.remaining = null;
  const auto = completed && mypa.settings.autoStart === true;
  state.endsAt = auto ? Date.now() + minutes(state.phase) : null;
  if (auto) start();
  else stopTicking();
  await persist();
  render();
  if (completed && mypa.settings.notify !== false) {
    const title = wasFocus ? (state.phase === "long" ? "Time for a long break" : "Time for a break") : "Back to it";
    const body = wasFocus ? "Nice work. Step away for a few minutes." : "Your break is over.";
    mypa.notify(title, body).catch(() => {});
  }
}

function loop() {
  if (state.endsAt && left() <= 0) void advance(true);
  else render();
}

function start() {
  stopTicking();
  tick = setInterval(loop, 250);
}

function stopTicking() {
  if (tick) clearInterval(tick);
  tick = null;
}

async function toggle() {
  if (state.endsAt) {
    state.remaining = left();
    state.endsAt = null;
    stopTicking();
  } else {
    state.endsAt = Date.now() + left();
    state.remaining = null;
    start();
  }
  await persist();
  render();
}

$("toggle").addEventListener("click", toggle);
$("skip").addEventListener("click", () => void advance(false));

$("reset").addEventListener("click", async () => {
  stopTicking();
  state = { ...state, phase: "focus", endsAt: null, remaining: null };
  await persist();
  render();
});

// Space starts or pauses, unless a button already has focus (it handles Space itself).
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.target instanceof HTMLButtonElement) return;
  e.preventDefault();
  void toggle();
});

mypa.onSettings(render);

mypa.ready.then(async () => {
  const saved = await mypa.storage.get("state");
  if (saved) state = { ...state, ...saved, streak: Number(saved.streak) || 0 };
  if (state.endsAt) {
    if (left() <= 0) await advance(true);
    else start();
  }
  render();
});
