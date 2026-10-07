const $ = (id) => document.getElementById(id);
const RANK = { high: 0, medium: 1, low: 2 };
const LABEL = { high: "Important", medium: "Normal", low: "Low" };
/** Tasks ticked here in the last few seconds stay visible (struck through) so a
 *  mis-click is easy to undo before they leave the list. */
const recentlyDone = new Map();
const LINGER_MS = 4000;
const canTick = typeof mypa.tasks.setDone === "function";

function dueText(due) {
  if (due == null) return "";
  const ms = due - Date.now();
  if (ms <= 0) return "overdue";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
  if (h >= 24) return `${Math.floor(h / 24)}d left`;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

function render(tasks) {
  const now = Date.now();
  for (const [id, at] of recentlyDone) if (now - at > LINGER_MS) recentlyDone.delete(id);

  const today = tasks.filter((t) => t.section === "today");
  const done = today.filter((t) => t.done).length;
  $("count").textContent = today.length ? `${done} of ${today.length} done` : "";
  $("fill").style.transform = `scaleX(${today.length ? done / today.length : 0})`;
  const n = Math.max(1, Math.min(8, Number(mypa.settings.count) || 3));
  const open = today
    .filter((t) => !t.done || recentlyDone.has(t.id))
    .sort(
      (a, b) =>
        RANK[a.importance] - RANK[b.importance] || (a.due ?? Infinity) - (b.due ?? Infinity),
    )
    .slice(0, n);

  const list = $("list");
  list.replaceChildren(
    ...open.map((t, i) => {
      const li = document.createElement("li");
      li.className = `tf__item${t.done ? " is-done" : ""}`;
      if (!canTick) {
        // Older hosts can't tick tasks off; show the rank instead of a checkbox.
        const rank = document.createElement("span");
        rank.className = "tf__rank num";
        rank.textContent = String(i + 1);
        li.append(rank);
      } else {
        const check = document.createElement("button");
        check.type = "button";
        check.className = `tf__check${t.done ? " is-on" : ""}`;
        check.setAttribute("aria-pressed", String(t.done));
        check.setAttribute("aria-label", t.done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`);
        check.addEventListener("click", async () => {
          if (!t.done) recentlyDone.set(t.id, Date.now());
          else recentlyDone.delete(t.id);
          await mypa.tasks.setDone(t.id, !t.done);
          setTimeout(() => render(latest), LINGER_MS + 50);
        });
        li.append(check);
      }
      const body = document.createElement("span");
      body.className = "tf__body";
      const title = document.createElement("span");
      title.className = "tf__title";
      title.textContent = t.title;
      body.append(title);
      const due = dueText(t.due);
      if (due && !t.done) {
        const d = document.createElement("small");
        d.className = `tf__due num${due === "overdue" || t.due - Date.now() < 86_400_000 ? " is-soon" : ""}`;
        d.textContent = due;
        body.append(d);
      }
      const prio = document.createElement("span");
      prio.className = "tf__prio";
      prio.dataset.i = t.importance;
      prio.title = LABEL[t.importance];
      li.append(body, prio);
      return li;
    }),
  );

  const empty = $("empty");
  empty.hidden = open.length > 0;
  empty.textContent = today.length
    ? "Everything for today is done. Nice."
    : "Nothing planned for today yet. Add something below.";
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("title").value.trim();
  if (!title) return;
  $("title").value = "";
  await mypa.tasks.create({ title, importance: newImportance });
});

/* New-task importance: a small square that cycles, like the To-do list's. */
const ORDER = ["high", "medium", "low"];
let newImportance = "high";
function paintPrio() {
  const b = $("prio");
  b.dataset.i = newImportance;
  b.setAttribute("aria-label", `Importance: ${LABEL[newImportance]}. Change`);
  b.title = `${LABEL[newImportance]}. Click to change`;
}
$("prio").addEventListener("click", () => {
  newImportance = ORDER[(ORDER.indexOf(newImportance) + 1) % ORDER.length];
  paintPrio();
});
paintPrio();

let latest = [];
mypa.tasks.onChange((tasks) => {
  latest = tasks;
  render(tasks);
});
mypa.onSettings(() => render(latest));
mypa.ready.then(async () => {
  latest = await mypa.tasks.list();
  render(latest);
  setInterval(() => render(latest), 30_000);
});
