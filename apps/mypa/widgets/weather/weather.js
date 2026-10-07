const root = document.getElementById("root");
const TTL = 30 * 60_000;
const SVG_NS = "http://www.w3.org/2000/svg";

/* Line icons (24×24, 2px stroke), drawn to match the app's icon set. */
const CLOUD = "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z";
const CLOUD_TOP = "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242";
const ICONS = {
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  partly: ["M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41", "M15.947 12.65a4 4 0 0 0-5.925-4.128", "M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"],
  cloud: [CLOUD],
  fog: [CLOUD_TOP, "M16 17H7M17 21H9"],
  drizzle: [CLOUD_TOP, "M8 19v1M8 14v1M16 19v1M16 14v1M12 21v1M12 16v1"],
  rain: [CLOUD_TOP, "M16 14v6M8 14v6M12 16v6"],
  snow: [CLOUD_TOP, "M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"],
  storm: ["M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973", "M13 12l-3 5h4l-3 5"],
};

// WMO weather codes, grouped.
function describe(code) {
  if (code === 0) return { text: "Clear", icon: "sun" };
  if (code <= 2) return { text: "Partly cloudy", icon: "partly" };
  if (code === 3) return { text: "Overcast", icon: "cloud" };
  if (code <= 48) return { text: "Fog", icon: "fog" };
  if (code <= 57) return { text: "Drizzle", icon: "drizzle" };
  if (code <= 67) return { text: "Rain", icon: "rain" };
  if (code <= 77) return { text: "Snow", icon: "snow" };
  if (code <= 82) return { text: "Showers", icon: "rain" };
  if (code <= 86) return { text: "Snow showers", icon: "snow" };
  return { text: "Thunderstorm", icon: "storm" };
}

function icon(name, size, label) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", "wx__icon");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function message(text) {
  root.replaceChildren(el("p", "wx__msg muted", text));
}

/** Fetches JSON, treating an error reply (e.g. a rate limit) as a failure
 *  so it is never cached or rendered as a forecast. */
async function getJson(url) {
  const res = await mypa.fetch(url);
  const data = await res.json();
  if (!res.ok || data?.error) {
    const err = new Error(data?.reason || `HTTP ${res.status}`);
    err.busy = res.status === 429 || /limit/i.test(String(data?.reason));
    throw err;
  }
  return data;
}

async function geocode(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`;
  const data = await getJson(url);
  const hit = data.results?.[0];
  if (!hit) return null;
  return { name: hit.name, country: hit.country_code, lat: hit.latitude, lon: hit.longitude };
}

async function forecast(place, units) {
  const wind = units === "fahrenheit" ? "mph" : "kmh";
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m` +
    `&hourly=temperature_2m,weather_code,precipitation_probability,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=5&temperature_unit=${units}&wind_speed_unit=${wind}`;
  return getJson(url);
}

function ago(at) {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "Updated just now";
  if (min < 60) return `Updated ${min} min ago`;
  return `Updated ${Math.round(min / 60)} h ago`;
}

const deg = (n) => `${Math.round(n)}°`;

function render(place, data, at) {
  const units = mypa.settings.units === "fahrenheit" ? "mph" : "km/h";
  const cur = data.current;
  const now = describe(cur.weather_code);
  const nowIcon = now.icon === "sun" && cur.is_day === 0 ? "moon" : now.icon;

  const head = el("div", "wx__now");
  const left = el("div", "wx__where");
  left.append(el("p", "wx__place", `${place.name}${place.country ? `, ${place.country}` : ""}`));
  const cond = el("p", "wx__cond");
  cond.append(icon(nowIcon, 16), document.createTextNode(now.text));
  left.append(cond);
  head.append(left, el("span", "wx__temp num", deg(cur.temperature_2m)));

  const facts = el("p", "wx__facts num");
  const rain = data.daily.precipitation_probability_max?.[0];
  facts.textContent = [
    `H ${deg(data.daily.temperature_2m_max[0])} · L ${deg(data.daily.temperature_2m_min[0])}`,
    rain != null ? `Rain ${rain}%` : null,
    cur.apparent_temperature != null ? `Feels ${deg(cur.apparent_temperature)}` : null,
    cur.wind_speed_10m != null ? `Wind ${Math.round(cur.wind_speed_10m)} ${units}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // next six hours, starting from the coming hour
  const hours = el("div", "wx__hours");
  const start = data.hourly.time.findIndex((t) => new Date(t).getTime() > Date.now() - 3_600_000);
  for (let i = Math.max(0, start); i < Math.max(0, start) + 6 && i < data.hourly.time.length; i++) {
    const h = el("div", "wx__hour");
    const c = describe(data.hourly.weather_code[i]);
    const ic = c.icon === "sun" && data.hourly.is_day[i] === 0 ? "moon" : c.icon;
    h.append(
      el(
        "span",
        "wx__hour-t num",
        new Date(data.hourly.time[i]).toLocaleTimeString(undefined, { hour: "numeric" }),
      ),
      icon(ic, 16, c.text),
      el("b", "num", deg(data.hourly.temperature_2m[i])),
    );
    hours.append(h);
  }

  const days = el("div", "wx__days");
  data.daily.time.slice(1, 5).forEach((iso, i) => {
    const d = el("div", "wx__day");
    const c = describe(data.daily.weather_code[i + 1]);
    const name = new Date(`${iso}T12:00`).toLocaleDateString(undefined, { weekday: "short" });
    d.append(el("b", "", name), icon(c.icon, 18, c.text));
    d.append(
      el(
        "span",
        "num",
        `${deg(data.daily.temperature_2m_max[i + 1])} / ${deg(data.daily.temperature_2m_min[i + 1])}`,
      ),
    );
    d.title = c.text;
    days.append(d);
  });

  const updated = el("button", "wx__updated", ago(at));
  updated.type = "button";
  updated.title = "Refresh now";
  updated.addEventListener("click", () => {
    updated.textContent = "Updating…";
    void load(true);
  });

  root.replaceChildren(head, facts, hours, days, updated);
}

let lastAt = 0;
let retryTimer = null;
async function load(force = false) {
  const city = String(mypa.settings.city || "").trim();
  const units = mypa.settings.units === "fahrenheit" ? "fahrenheit" : "celsius";
  if (!city) return message("Set your city in this widget's settings.");
  const cached = await mypa.storage.get("cache");
  // Only a complete forecast counts; older or broken cache entries are refetched.
  const fresh = Boolean(cached?.data?.hourly && cached.data.current?.apparent_temperature !== undefined);
  if (
    !force &&
    fresh &&
    cached.city === city &&
    cached.units === units &&
    Date.now() - cached.at < TTL
  ) {
    lastAt = cached.at;
    return render(cached.place, cached.data, cached.at);
  }
  try {
    const place = cached?.city === city ? cached.place : await geocode(city);
    if (!place) return message(`Couldn't find “${city}”. Check the spelling in settings.`);
    const data = await forecast(place, units);
    const at = Date.now();
    await mypa.storage.set("cache", { city, units, place, data, at });
    lastAt = at;
    render(place, data, at);
  } catch (err) {
    if (fresh) render(cached.place, cached.data, cached.at);
    else
      message(
        err?.busy
          ? "The forecast service is busy right now. Trying again in a minute."
          : "Couldn't reach the forecast service. It'll try again shortly.",
      );
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void load(true), 60_000);
  }
}

/** Refetch only when the city or units really change. Saving the cache also
 *  fires onSettings on some hosts, and refetching then would loop. */
let seen = "";
const settingsKey = () => JSON.stringify([mypa.settings.city ?? "", mypa.settings.units ?? ""]);
mypa.onSettings(() => {
  const key = settingsKey();
  if (key === seen) return;
  seen = key;
  void load(true);
});
mypa.ready.then(() => {
  seen = settingsKey();
  void load();
  setInterval(() => void load(), TTL);
  // keep "Updated x min ago" honest between refreshes
  setInterval(() => {
    const u = root.querySelector(".wx__updated");
    if (u && lastAt && u.textContent !== "Updating…") u.textContent = ago(lastAt);
  }, 60_000);
});
