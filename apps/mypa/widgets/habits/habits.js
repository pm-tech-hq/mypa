const $ = (id) => document.getElementById(id);
// habits: [{ id, name, days: { "YYYY-MM-DD": true } }]
let habits = [];
/** Last removed habit and where it was, for Undo. */
let removed = null;
let undoTimer = null;
let editingId = null;

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  check: "M4 8.5 6.8 11 12 5",
  x: "M4.5 4.5l7 7M11.5 4.5l-7 7",
};

function icon(name, size = 14) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

const key = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** How many days fit next to a readable name: usually a week, fewer when the
 *  widget is narrow, up to three weeks when it is wide. */
function dayCount() {
  const room = document.body.clientWidth - 28 - 130 - 48;
  return Math.max(5, Math.min(21, Math.floor(room / 30)));
}

const lastDays = (n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1 - i));
    return d;
  });

function streak(h) {
  let n = 0;
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  // Today not ticked yet doesn't break the streak.
  if (!h.days[key(d)]) d.setDate(d.getDate() - 1);
  while (h.days[key(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function best(h) {
  const days = Object.keys(h.days).sort();
  let top = 0;
  let run = 0;
  let prev = null;
  for (const k of days) {
    const t = new Date(`${k}T12:00:00`).getTime();
    run = prev !== null && Math.round((t - prev) / 86_400_000) === 1 ? run + 1 : 1;
    top = Math.max(top, run);
    prev = t;
  }
  return top;
}

function rate30(h) {
  return Math.round((lastDays(30).filter((d) => h.days[key(d)]).length / 30) * 100);
}

const save = () => mypa.storage.set("habits", habits);

function el(tag, props = {}, text) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderSummary() {
  const today = key(new Date());
  const done = habits.filter((h) => h.days[today]).length;
  $("summary").textContent = habits.length
    ? done === habits.length
      ? `All ${habits.length} done today`
      : `${done} of ${habits.length} done today`
    : "";
  $("summary").classList.toggle("is-done", habits.length > 0 && done === habits.length);
}

function render() {
  const grid = $("grid");
  grid.replaceChildren();
  $("empty").hidden = habits.length > 0;
  renderSummary();
  if (!habits.length) return;
  const n = dayCount();
  const days = lastDays(n);
  grid.style.gridTemplateColumns = `minmax(120px, 1fr) repeat(${n}, 26px) 44px`;
  const todayKey = key(new Date());
  grid.append(el("span"));
  for (const d of days) {
    const head = el("span", { className: `hab__day${key(d) === todayKey ? " is-today" : ""}` });
    head.append(
      el("span", {}, d.toLocaleDateString(undefined, { weekday: "narrow" })),
      el("span", { className: "hab__date num" }, String(d.getDate())),
    );
    head.title = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    grid.append(head);
  }
  grid.append(el("span"));

  for (const h of habits) {
    const row = el("div", { className: "hab__row" });
    const name = el("div", { className: "hab__name" });
    if (editingId === h.id) {
      const input = el("input", { className: "hab__rename", value: h.name, maxLength: 60 });
      input.setAttribute("aria-label", "Habit name");
      const finish = (keep) => {
        if (editingId !== h.id) return;
        const next = input.value.trim();
        if (keep && next) h.name = next;
        editingId = null;
        void save().then(render);
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
      name.append(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    } else {
      const label = el("button", { className: "hab__label", type: "button" }, h.name);
      label.title = `Best streak ${best(h)}d · ${rate30(h)}% of the last 30 days. Click to rename`;
      label.addEventListener("click", () => {
        editingId = h.id;
        render();
      });
      const del = el("button", { className: "hab__del", type: "button", title: "Remove habit" });
      del.append(icon("x", 12));
      del.setAttribute("aria-label", `Remove ${h.name}`);
      del.addEventListener("click", () => remove(h));
      name.append(label, del);
    }
    row.append(name);

    for (const d of days) {
      const k = key(d);
      const on = Boolean(h.days[k]);
      const cell = el("button", {
        className: `hab__cell${on ? " is-on" : ""}${k === todayKey ? " is-today" : ""}`,
        type: "button",
      });
      if (on) cell.append(icon("check", 14));
      cell.setAttribute("aria-pressed", String(on));
      cell.setAttribute(
        "aria-label",
        `${h.name}, ${d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`,
      );
      cell.addEventListener("click", () => {
        if (h.days[k]) delete h.days[k];
        else h.days[k] = true;
        void save().then(render);
      });
      row.append(cell);
    }
    const s = streak(h);
    const st = el("span", { className: `hab__streak num${s > 1 ? " is-live" : ""}` }, `${s}d`);
    st.title = s === 1 ? "1 day in a row" : `${s} days in a row`;
    row.append(st);
    grid.append(row);
  }
}

function remove(h) {
  const index = habits.findIndex((x) => x.id === h.id);
  if (index < 0) return;
  // An earlier removal still pending is final now.
  removed = { habit: habits[index], index };
  habits.splice(index, 1);
  void save().then(render);
  $("undo-label").textContent = `Removed “${h.name}”`;
  $("undo").hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 6000);
}

function hideUndo() {
  $("undo").hidden = true;
  removed = null;
}

$("undo-btn").addEventListener("click", () => {
  if (!removed) return;
  habits.splice(Math.min(removed.index, habits.length), 0, removed.habit);
  clearTimeout(undoTimer);
  hideUndo();
  void save().then(render);
});
$("undo-close").addEventListener("click", () => {
  clearTimeout(undoTimer);
  hideUndo();
});
$("undo-close").append(icon("x", 12));

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("name").value.trim();
  if (!name) return;
  habits.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name, days: {} });
  $("name").value = "";
  void save().then(render);
});

let lastCount = 0;
new ResizeObserver(() => {
  const n = dayCount();
  if (n !== lastCount) {
    lastCount = n;
    if (editingId === null) render();
  }
}).observe(document.body);

// The day rolls over while the widget stays open: redraw at midnight.
setInterval(() => {
  const head = document.querySelector(".hab__day.is-today")?.getAttribute("title");
  const now = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  if (head && head !== now && editingId === null) render();
}, 60_000);

mypa.ready.then(async () => {
  habits = (await mypa.storage.get("habits")) ?? [];
  render();
});
