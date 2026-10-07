const list = document.getElementById("list");

/** Every IANA zone this system knows, for turning "Tokyo" into Asia/Tokyo. */
const ZONES = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();
const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();

/** Accepts "Name=Area/City", "Area/City" or just a city name. */
function resolve(entry) {
  if (entry.includes("=")) {
    const [name, zone] = entry.split("=").map((x) => x.trim());
    return { name: name || zone, zone };
  }
  if (entry.includes("/")) return { name: entry.split("/").pop().replace(/_/g, " "), zone: entry };
  const city = norm(entry);
  const zone = ZONES.find((z) => norm(z.split("/").pop()) === city);
  return { name: entry, zone: zone ?? entry };
}

function places() {
  return String(mypa.settings.zones || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(resolve);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Minutes the zone is ahead of local time right now. */
function offsetMinutes(zone, now) {
  const at = (tz) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(now)
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  };
  return Math.round((at(zone) - at(undefined)) / 60_000);
}

function formatOffset(min) {
  if (min === 0) return "same time";
  const sign = min > 0 ? "+" : "−";
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign}${h ? `${h}h` : ""}${m ? `${h ? " " : ""}${m}m` : ""}`;
}

function render() {
  const now = new Date();
  const localDay = now.toLocaleDateString("en-CA");
  list.replaceChildren(
    ...places().map(({ name, zone }) => {
      const li = el("li", "wc__row");
      try {
        const time = now.toLocaleTimeString(undefined, {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: Boolean(mypa.settings.hour12),
        });
        const hour = Number(
          now.toLocaleString("en-GB", { timeZone: zone, hour: "2-digit", hour12: false }),
        );
        const day = now.toLocaleDateString("en-CA", { timeZone: zone });
        const rel = day === localDay ? "Today" : day > localDay ? "Tomorrow" : "Yesterday";
        const work = hour >= 9 && hour < 18;
        const night = hour >= 22 || hour < 7;
        const state = work ? "working hours" : night ? "night" : "";
        const dot = el("span", `wc__dot${work ? " is-work" : night ? " is-night" : ""}`);
        dot.title = work ? "Working hours" : night ? "Night" : "Outside working hours";
        const place = el("span", "wc__place");
        const meta = [rel, state, formatOffset(offsetMinutes(zone, now))].filter(Boolean).join(" · ");
        place.append(el("b", "", name), el("small", "num", meta));
        li.append(dot, place, el("span", "wc__time num", time));
      } catch {
        li.append(
          el("span", "wc__err", `Couldn't find “${name}”. Try a city like Tokyo, or a zone like Europe/London.`),
        );
      }
      return li;
    }),
  );
  if (!list.childElementCount) {
    list.append(el("li", "wc__empty", "Add places in this widget's settings, e.g. London, Tokyo."));
  }
}

/** Redraw on each minute boundary so the clocks never lag. */
function schedule() {
  const now = Date.now();
  setTimeout(() => {
    render();
    schedule();
  }, 60_000 - (now % 60_000) + 50);
}

mypa.onSettings(render);
mypa.ready.then(() => {
  render();
  schedule();
});
