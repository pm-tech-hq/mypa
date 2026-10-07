const $ = (id) => document.getElementById(id);

/** Edits made in the widget itself. They win until the settings change again. */
let local = null;
let timer = null;

const pad = (n) => String(n).padStart(2, "0");

function current() {
  return {
    title: (local?.title ?? mypa.settings.title) || "Countdown",
    date: String(local?.date ?? mypa.settings.date ?? "").trim(),
  };
}

function parse(raw) {
  if (!raw) return null;
  const d = new Date(raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DDTHH:MM" for <input type="datetime-local">. */
function toInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function unit(value, label, accent) {
  const wrap = document.createElement("div");
  wrap.className = `cd__unit${accent ? " is-accent" : ""}`;
  const b = document.createElement("b");
  b.textContent = String(value);
  const s = document.createElement("span");
  s.textContent = label;
  wrap.append(b, s);
  return wrap;
}

const plural = (n, one, many) => (n === 1 ? one : many);

function render() {
  const { title, date } = current();
  const t = parse(date);
  $("title").textContent = title;
  $("view").hidden = !t;
  $("setup").hidden = Boolean(t) || !$("editor").hidden;
  if (!t) {
    schedule(60_000);
    return;
  }
  let diff = t.getTime() - Date.now();
  const past = diff <= 0;
  diff = Math.abs(diff);
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const units = $("units");
  // Within the last hour (either side) the seconds matter; otherwise days lead.
  const close = diff < 3_600_000;
  units.replaceChildren(
    ...(close
      ? [unit(m, plural(m, "minute", "minutes"), true), unit(pad(s), plural(s, "second", "seconds"))]
      : [
          unit(d, plural(d, "day", "days"), true),
          unit(h, plural(h, "hour", "hours")),
          unit(m, plural(m, "minute", "minutes")),
        ]),
  );
  const when = t.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const justHappened = past && diff < 60_000;
  $("status").hidden = !justHappened;
  $("when").textContent = past ? `Since ${when}` : `Until ${when}`;
  document.body.dataset.past = String(past);
  schedule(close ? 1000 : 15_000);
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(render, ms);
}

/* ---- inline editor ------------------------------------------------------ */
function openEditor() {
  const { title, date } = current();
  const t = parse(date);
  $("in-title").value = title === "Countdown" && !mypa.settings.title ? "" : title;
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 7);
  fallback.setHours(9, 0, 0, 0);
  $("in-date").value = toInput(t ?? fallback);
  $("editor").hidden = false;
  $("title").parentElement.hidden = true;
  $("view").hidden = true;
  $("setup").hidden = true;
  $("in-title").focus();
}

function closeEditor() {
  $("editor").hidden = true;
  $("title").parentElement.hidden = false;
  render();
}

$("editor").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = $("in-date").value;
  if (!parse(date)) {
    $("in-date").focus();
    return;
  }
  local = { title: $("in-title").value.trim() || "Countdown", date };
  await mypa.storage.set("local", local);
  closeEditor();
});
$("cancel").addEventListener("click", closeEditor);
$("editor").addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEditor();
});
$("edit").addEventListener("click", openEditor);
$("start").addEventListener("click", openEditor);

/** The title/date the settings held last time; saving storage also fires
 *  onSettings, so only a real change to these two counts as a new edit. */
let seen = "";
const settingsKey = () => JSON.stringify([mypa.settings.title ?? "", mypa.settings.date ?? ""]);

mypa.onSettings(async () => {
  const key = settingsKey();
  if (key !== seen) {
    seen = key;
    // A change made in settings is the newest edit.
    local = null;
    await mypa.storage.remove("local");
  }
  render();
});

mypa.ready.then(async () => {
  seen = settingsKey();
  local = (await mypa.storage.get("local")) ?? null;
  render();
});
