/**
 * Unit conversion. Every unit is defined by its exact factor to a base unit
 * (from the international definitions: 1 in = 0.0254 m, 1 lb = 0.45359237 kg,
 * 1 US gal = 231 in³ …) and converted with the calculator's exact decimals, so
 * 1 mi → 1.609344 km comes out exact. Temperatures use offsets; fuel economy
 * in L/100 km is the reciprocal of distance per volume.
 */
import { CalcError, DEC_PI, decAdd, decDiv, decMul, decSub, evaluate, formatDec, parseDec, type Dec } from "./calc";

export type UnitCategory =
  | "length"
  | "mass"
  | "volume"
  | "temperature"
  | "area"
  | "speed"
  | "time"
  | "data"
  | "energy"
  | "pressure"
  | "power"
  | "fuel"
  | "angle";

export interface UnitDef {
  id: string;
  category: UnitCategory;
  name: string;
  symbol: string;
  /** Exact: base units per one of this unit, as "a", "a/b" or "a*b/c*d". For
   *  "inverse" units: the constant k in base = k / value. */
  factor: string;
  /** Added to the value before scaling, in this unit (°F: −32, K: −273.15). */
  pre?: string;
  /** value = k / base (L/100 km). */
  inverse?: boolean;
  /** Factor isn't exact (involves π). */
  approx?: boolean;
  /** Extra names people type (lowercase unless `caseSensitive`). */
  aliases: string[];
  caseSensitive?: string[];
}

export const CATEGORIES: { id: UnitCategory; label: string; base: string; common: [string, string] }[] = [
  { id: "length", label: "Length", base: "m", common: ["ft", "m"] },
  { id: "mass", label: "Weight", base: "kg", common: ["lb", "kg"] },
  { id: "volume", label: "Volume", base: "l", common: ["cup", "ml"] },
  { id: "temperature", label: "Temperature", base: "c", common: ["f", "c"] },
  { id: "area", label: "Area", base: "m2", common: ["ft2", "m2"] },
  { id: "speed", label: "Speed", base: "mps", common: ["mph", "kmh"] },
  { id: "time", label: "Time", base: "s", common: ["h", "min"] },
  { id: "data", label: "Data", base: "byte", common: ["gb", "mb"] },
  { id: "energy", label: "Energy", base: "j", common: ["kcal", "kj"] },
  { id: "pressure", label: "Pressure", base: "pa", common: ["psi", "bar"] },
  { id: "power", label: "Power", base: "w", common: ["hp", "kw"] },
  { id: "fuel", label: "Fuel economy", base: "kmpl", common: ["mpg", "l100km"] },
  { id: "angle", label: "Angle", base: "deg", common: ["deg", "rad"] },
];

const u = (
  category: UnitCategory,
  id: string,
  name: string,
  symbol: string,
  factor: string,
  aliases: string[] = [],
  extra: Partial<UnitDef> = {},
): UnitDef => ({ id, category, name, symbol, factor, aliases, ...extra });

export const UNITS: UnitDef[] = [
  // length (base: metre)
  u("length", "km", "Kilometres", "km", "1000", ["kilometer", "kilometers", "kilometre", "kilometres", "kms"]),
  u("length", "m", "Metres", "m", "1", ["meter", "meters", "metre", "metres"]),
  u("length", "cm", "Centimetres", "cm", "0.01", ["centimeter", "centimeters", "centimetre", "centimetres"]),
  u("length", "mm", "Millimetres", "mm", "0.001", ["millimeter", "millimeters", "millimetre", "millimetres"]),
  u("length", "um", "Micrometres", "µm", "0.000001", ["µm", "micron", "microns", "micrometer", "micrometers", "micrometre", "micrometres"]),
  u("length", "mi", "Miles", "mi", "1609.344", ["mile", "miles"]),
  u("length", "yd", "Yards", "yd", "0.9144", ["yard", "yards", "yds"]),
  u("length", "ft", "Feet", "ft", "0.3048", ["foot", "feet", "'", "′"]),
  u("length", "in", "Inches", "in", "0.0254", ["inch", "inches", '"', "″", "ins"]),
  u("length", "nmi", "Nautical miles", "nmi", "1852", ["nautical mile", "nautical miles", "nm"]),

  // mass (base: kilogram)
  u("mass", "t", "Tonnes", "t", "1000", ["tonne", "tonnes", "metric ton", "metric tons"]),
  u("mass", "kg", "Kilograms", "kg", "1", ["kilogram", "kilograms", "kilo", "kilos", "kgs"]),
  u("mass", "g", "Grams", "g", "0.001", ["gram", "grams", "gr", "gm"]),
  u("mass", "mg", "Milligrams", "mg", "0.000001", ["milligram", "milligrams"]),
  u("mass", "ug", "Micrograms", "µg", "0.000000001", ["µg", "mcg", "microgram", "micrograms"]),
  u("mass", "st", "Stone", "st", "6.35029318", ["stone", "stones"]),
  u("mass", "lb", "Pounds", "lb", "0.45359237", ["pound", "pounds", "lbs"]),
  u("mass", "oz", "Ounces", "oz", "0.028349523125", ["ounce", "ounces"]),
  u("mass", "uston", "US tons", "US ton", "907.18474", ["ton", "tons", "us ton", "us tons", "short ton", "short tons"]),
  u("mass", "ukton", "UK tons", "UK ton", "1016.0469088", ["uk ton", "uk tons", "long ton", "long tons", "imperial ton"]),

  // volume (base: litre)
  u("volume", "m3", "Cubic metres", "m³", "1000", ["m³", "cubic meter", "cubic meters", "cubic metre", "cubic metres"]),
  u("volume", "l", "Litres", "L", "1", ["liter", "liters", "litre", "litres", "ltr"]),
  u("volume", "dl", "Decilitres", "dL", "0.1", ["deciliter", "deciliters", "decilitre", "decilitres"]),
  u("volume", "ml", "Millilitres", "mL", "0.001", ["milliliter", "milliliters", "millilitre", "millilitres", "cc", "cm3", "cm³"]),
  u("volume", "gal", "US gallons", "gal", "3.785411784", ["gallon", "gallons", "us gal", "us gallon", "us gallons", "gals"]),
  u("volume", "qt", "US quarts", "qt", "0.946352946", ["quart", "quarts", "us quart", "us quarts"]),
  u("volume", "pt", "US pints", "pt", "0.473176473", ["pint", "pints", "us pint", "us pints"]),
  u("volume", "cup", "US cups", "cup", "0.2365882365", ["cups", "us cup", "us cups"]),
  u("volume", "floz", "US fluid ounces", "fl oz", "0.0295735295625", ["fl oz", "fl. oz", "fluid ounce", "fluid ounces", "us fl oz"]),
  u("volume", "tbsp", "Tablespoons", "tbsp", "0.01478676478125", ["tablespoon", "tablespoons", "tbs", "tbl"]),
  u("volume", "tsp", "Teaspoons", "tsp", "0.00492892159375", ["teaspoon", "teaspoons"]),
  u("volume", "impgal", "Imperial gallons", "imp gal", "4.54609", ["imp gal", "uk gal", "uk gallon", "uk gallons", "imperial gallon", "imperial gallons"]),
  u("volume", "imppt", "Imperial pints", "imp pt", "0.56826125", ["imp pt", "uk pint", "uk pints", "imperial pint", "imperial pints"]),
  u("volume", "impfloz", "Imperial fluid ounces", "imp fl oz", "0.0284130625", ["imp fl oz", "uk fl oz"]),
  u("volume", "ft3", "Cubic feet", "ft³", "28.316846592", ["ft³", "cu ft", "cubic foot", "cubic feet"]),
  u("volume", "in3", "Cubic inches", "in³", "0.016387064", ["in³", "cu in", "cubic inch", "cubic inches"]),

  // temperature (base: Celsius); °F: C = (F − 32) × 5/9 → factor 5/9, offset −160/9
  u("temperature", "c", "Celsius", "°C", "1", ["°c", "celsius", "centigrade", "degc", "deg c", "degrees c", "degrees celsius"]),
  u("temperature", "f", "Fahrenheit", "°F", "5/9", ["°f", "fahrenheit", "degf", "deg f", "degrees f", "degrees fahrenheit"], {
    pre: "-32",
  }),
  u("temperature", "k", "Kelvin", "K", "1", ["kelvin", "kelvins"], { pre: "-273.15" }),

  // area (base: square metre)
  u("area", "km2", "Square kilometres", "km²", "1000000", ["km²", "sq km", "square kilometer", "square kilometers", "square kilometre", "square kilometres"]),
  u("area", "ha", "Hectares", "ha", "10000", ["hectare", "hectares"]),
  u("area", "m2", "Square metres", "m²", "1", ["m²", "sq m", "sqm", "square meter", "square meters", "square metre", "square metres"]),
  u("area", "cm2", "Square centimetres", "cm²", "0.0001", ["cm²", "sq cm", "square centimeter", "square centimeters", "square centimetre", "square centimetres"]),
  u("area", "mi2", "Square miles", "mi²", "2589988.110336", ["mi²", "sq mi", "square mile", "square miles"]),
  u("area", "acre", "Acres", "ac", "4046.8564224", ["acres", "ac"]),
  u("area", "yd2", "Square yards", "yd²", "0.83612736", ["yd²", "sq yd", "square yard", "square yards"]),
  u("area", "ft2", "Square feet", "ft²", "0.09290304", ["ft²", "sq ft", "sqft", "square foot", "square feet"]),
  u("area", "in2", "Square inches", "in²", "0.00064516", ["in²", "sq in", "square inch", "square inches"]),

  // speed (base: metre per second)
  u("speed", "kmh", "Kilometres per hour", "km/h", "5/18", ["km/h", "kph", "kmph", "kilometers per hour", "kilometres per hour"]),
  u("speed", "mph", "Miles per hour", "mph", "0.44704", ["mi/h", "miles per hour"]),
  u("speed", "mps", "Metres per second", "m/s", "1", ["m/s", "meters per second", "metres per second"]),
  u("speed", "fps", "Feet per second", "ft/s", "0.3048", ["ft/s", "feet per second"]),
  u("speed", "kn", "Knots", "kn", "463/900", ["knot", "knots", "kt", "kts"]),

  // time (base: second)
  u("time", "ms", "Milliseconds", "ms", "0.001", ["millisecond", "milliseconds"]),
  u("time", "s", "Seconds", "s", "1", ["sec", "secs", "second", "seconds"]),
  u("time", "min", "Minutes", "min", "60", ["mins", "minute", "minutes"]),
  u("time", "h", "Hours", "h", "3600", ["hr", "hrs", "hour", "hours"]),
  u("time", "day", "Days", "d", "86400", ["d", "days"]),
  u("time", "week", "Weeks", "wk", "604800", ["wk", "wks", "weeks"]),
  u("time", "month", "Months (average)", "mo", "2629800", ["mo", "months"]),
  u("time", "year", "Years (365.25 days)", "yr", "31557600", ["yr", "yrs", "years"]),

  // data (base: byte)
  u("data", "bit", "Bits", "bit", "0.125", ["bits"]),
  u("data", "byte", "Bytes", "B", "1", ["bytes", "b"]),
  u("data", "kb", "Kilobytes", "kB", "1000", ["kilobyte", "kilobytes"]),
  u("data", "mb", "Megabytes", "MB", "1000000", ["megabyte", "megabytes"]),
  u("data", "gb", "Gigabytes", "GB", "1000000000", ["gigabyte", "gigabytes"]),
  u("data", "tb", "Terabytes", "TB", "1000000000000", ["terabyte", "terabytes"]),
  u("data", "kib", "Kibibytes", "KiB", "1024", ["kibibyte", "kibibytes"]),
  u("data", "mib", "Mebibytes", "MiB", "1048576", ["mebibyte", "mebibytes"]),
  u("data", "gib", "Gibibytes", "GiB", "1073741824", ["gibibyte", "gibibytes"]),
  u("data", "tib", "Tebibytes", "TiB", "1099511627776", ["tebibyte", "tebibytes"]),

  // energy (base: joule)
  u("energy", "j", "Joules", "J", "1", ["joule", "joules"]),
  u("energy", "kj", "Kilojoules", "kJ", "1000", ["kilojoule", "kilojoules"]),
  u("energy", "mj", "Megajoules", "MJ", "1000000", ["megajoule", "megajoules"]),
  u("energy", "cal", "Calories", "cal", "4.184", ["calorie", "calories"]),
  u("energy", "kcal", "Kilocalories (food Calories)", "kcal", "4184", ["kilocalorie", "kilocalories"], {
    caseSensitive: ["Cal", "Calorie", "Calories"],
  }),
  u("energy", "wh", "Watt-hours", "Wh", "3600", ["watt hour", "watt hours", "watt-hour", "watt-hours"]),
  u("energy", "kwh", "Kilowatt-hours", "kWh", "3600000", ["kilowatt hour", "kilowatt hours", "kilowatt-hour", "kilowatt-hours"]),
  u("energy", "btu", "BTU", "BTU", "1055.05585262", ["btus", "british thermal unit", "british thermal units"]),

  // pressure (base: pascal)
  u("pressure", "pa", "Pascals", "Pa", "1", ["pascal", "pascals"]),
  u("pressure", "kpa", "Kilopascals", "kPa", "1000", ["kilopascal", "kilopascals"]),
  u("pressure", "bar", "Bar", "bar", "100000", ["bars"]),
  u("pressure", "mbar", "Millibar", "mbar", "100", ["millibar", "millibars", "hpa"]),
  u("pressure", "atm", "Atmospheres", "atm", "101325", ["atmosphere", "atmospheres"]),
  // 1 lbf / 1 in²: 0.45359237 kg × 9.80665 m/s² ÷ 0.0254² m²
  u("pressure", "psi", "Pounds per square inch", "psi", "0.45359237*9.80665/0.00064516", ["lbf/in2", "pounds per square inch"]),
  u("pressure", "mmhg", "Millimetres of mercury", "mmHg", "133.322387415", ["mm hg", "torr"]),
  u("pressure", "inhg", "Inches of mercury", "inHg", "3386.388640341", ["in hg"]),

  // power (base: watt)
  u("power", "w", "Watts", "W", "1", ["watt", "watts"]),
  u("power", "kw", "Kilowatts", "kW", "1000", ["kilowatt", "kilowatts"]),
  u("power", "hp", "Horsepower", "hp", "745.69987158227022", ["horsepower", "bhp"]),
  u("power", "ps", "Metric horsepower", "PS", "735.49875", ["metric horsepower", "cv"]),

  // fuel economy (base: km per litre)
  u("fuel", "kmpl", "Kilometres per litre", "km/L", "1", ["km/l", "kpl"]),
  u("fuel", "l100km", "Litres per 100 km", "L/100 km", "100", ["l/100km", "l/100 km", "l per 100km", "litres per 100km", "liters per 100km"], {
    inverse: true,
  }),
  u("fuel", "mpg", "Miles per US gallon", "mpg", "1.609344/3.785411784", ["us mpg", "mpg us", "miles per gallon"]),
  u("fuel", "mpgimp", "Miles per UK gallon", "mpg (UK)", "1.609344/4.54609", ["uk mpg", "mpg uk", "imperial mpg", "mpg imp"]),

  // angle (base: degree)
  u("angle", "deg", "Degrees", "°", "1", ["°", "degree", "degrees"]),
  u("angle", "rad", "Radians", "rad", "180/pi", ["radian", "radians"], { approx: true }),
  u("angle", "grad", "Gradians", "gon", "0.9", ["gon", "gradian", "gradians"]),
  u("angle", "turn", "Turns", "turn", "360", ["turns", "revolution", "revolutions", "rev"]),
  u("angle", "arcmin", "Arcminutes", "′", "1/60", ["arcminute", "arcminutes"]),
  u("angle", "arcsec", "Arcseconds", "″", "1/3600", ["arcsecond", "arcseconds"]),
];

const BY_ID = new Map(UNITS.map((x) => [x.id, x]));

export function unitById(id: string): UnitDef | null {
  return BY_ID.get(id) ?? null;
}

export function unitsIn(category: UnitCategory): UnitDef[] {
  return UNITS.filter((x) => x.category === category);
}

/** Every name a unit can be typed as (id, symbol, aliases), lowercase. */
const LOOKUP = new Map<string, UnitDef>();
const CASED = new Map<string, UnitDef>();
for (const x of UNITS) {
  for (const n of [x.id, x.symbol.toLowerCase(), ...x.aliases.map((a) => a.toLowerCase())]) {
    if (!LOOKUP.has(n)) LOOKUP.set(n, x);
  }
  for (const n of x.caseSensitive ?? []) CASED.set(n, x);
}

export function findUnit(name: string): UnitDef | null {
  const raw = name.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  if (!raw) return null;
  const cased = CASED.get(raw);
  if (cased) return cased;
  const n = raw.toLowerCase();
  return (
    LOOKUP.get(n) ??
    // "ft2", "ft^2" → "ft²"
    LOOKUP.get(n.replace(/\^?2$/, "²")) ??
    LOOKUP.get(n.replace(/\^?3$/, "³")) ??
    // plurals people make up ("kgs", "inchs")
    LOOKUP.get(n.replace(/e?s$/, "")) ??
    null
  );
}

/* ---------------------------------------------------------------- engine -- */

/** n / d, kept apart so a whole conversion divides only once (and stays exact when it can). */
interface Frac {
  n: Dec;
  d: Dec;
}

const ONE = parseDec("1");
const fracCache = new Map<string, Frac>();

function product(expr: string): Dec {
  return expr.split("*").reduce((acc, x) => decMul(acc, x.trim() === "pi" ? DEC_PI : parseDec(x)), ONE);
}

function frac(expr: string): Frac {
  let f = fracCache.get(expr);
  if (!f) {
    const [n, d] = expr.split("/");
    f = { n: product(n!), d: d === undefined ? ONE : product(d) };
    fracCache.set(expr, f);
  }
  return f;
}

const fMul = (a: Frac, b: Frac): Frac => ({ n: decMul(a.n, b.n), d: decMul(a.d, b.d) });
const fAdd = (a: Frac, b: Frac): Frac => ({ n: decAdd(decMul(a.n, b.d), decMul(b.n, a.d)), d: decMul(a.d, b.d) });
const fInv = (a: Frac): Frac => ({ n: a.d, d: a.n });
const fNeg = (a: Frac): Frac => ({ n: decMul(a.n, parseDec("-1")), d: a.d });
const whole = (x: Dec): Frac => ({ n: x, d: ONE });

function toBaseFrac(value: Dec, unit: UnitDef): Frac {
  if (unit.inverse) {
    if (value.m === 0n) throw new CalcError(`0 ${unit.symbol} can't be converted (it would be infinitely efficient).`);
    return fMul(frac(unit.factor), fInv(whole(value)));
  }
  const v = unit.pre ? fAdd(whole(value), frac(unit.pre)) : whole(value);
  return fMul(v, frac(unit.factor));
}

function fromBaseFrac(base: Frac, unit: UnitDef): Frac {
  if (unit.inverse) {
    if (base.n.m === 0n) throw new CalcError("That can't be converted (zero distance per litre).");
    return fMul(frac(unit.factor), fInv(base));
  }
  const v = fMul(base, fInv(frac(unit.factor)));
  return unit.pre ? fAdd(v, fNeg(frac(unit.pre))) : v;
}

export interface Conversion {
  value: Dec;
  /** False when a factor isn't exact (π) or the division didn't come out exact. */
  exact: boolean;
}

/** Whether a division came out exact (rather than worked to 40 digits). */
function isShort(d: Dec): boolean {
  return (d.m < 0n ? -d.m : d.m).toString().length < 30;
}

export function convert(value: Dec, from: UnitDef, to: UnitDef): Conversion {
  if (from.category !== to.category)
    throw new CalcError(`Can't convert ${from.name.toLowerCase()} to ${to.name.toLowerCase()}: they measure different things.`);
  const base = toBaseFrac(value, from);
  if (from.category === "temperature") {
    // base is °C; anything below −273.15 isn't a temperature
    const c = decDiv(base.n, base.d);
    if (decSub(c, parseDec("-273.15")).m < 0n) throw new CalcError("That's colder than absolute zero (−273.15 °C).");
  }
  if (from.id === to.id) return { value, exact: true };
  const out = fromBaseFrac(base, to);
  const result = decDiv(out.n, out.d);
  return { value: result, exact: !from.approx && !to.approx && isShort(result) };
}

/* --------------------------------------------------------------- parsing -- */

export interface ParsedQuery {
  value: Dec;
  /** The value as typed (for showing back). */
  amount: string;
  from: UnitDef;
  to: UnitDef | null;
}

/**
 * "5 ft 11 in", "5'11\"", "1 lb 4 oz", "11 st 6 lb", "1 h 30 min": worked out
 * exactly in the smaller unit (5 ft 11 in = 71 in).
 */
function compound(s: string): { value: Dec; from: UnitDef; amount: string } | null {
  const forms: [RegExp, string, string, string][] = [
    [/^(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet|foot)\s*(\d+(?:\.\d+)?)\s*(?:"|″|in|inch|inches)?$/i, "12", "in", "ft|in"],
    [/^(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\s*(\d+(?:\.\d+)?)\s*(?:oz|ounces?)$/i, "16", "oz", "lb|oz"],
    [/^(\d+(?:\.\d+)?)\s*(?:st|stone)\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)?$/i, "14", "lb", "st|lb"],
    [/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\s*(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)$/i, "60", "min", "h|min"],
  ];
  for (const [re, per, unit, names] of forms) {
    const m = re.exec(s);
    if (!m) continue;
    const [big, small] = names.split("|");
    const value = decAdd(decMul(parseDec(m[1]!), parseDec(per)), parseDec(m[2]!));
    return { value, from: BY_ID.get(unit)!, amount: `${m[1]} ${big} ${m[2]} ${small}` };
  }
  return null;
}

/**
 * "72°F to C", "5 ft 11 in in cm", "3/4 cup ml", "100 kph", "1.5e3 mg to g".
 * The amount can be a sum ("3/4", "2*12"). `to` is null when not given.
 */
export function parseQuery(input: string): ParsedQuery | null {
  const s = input.trim().replace(/\s+/g, " ").replace(/→|->|=/g, " to ");
  if (!s) return null;
  const words = s.split(" ");
  const candidates: [string, string | null][] = [];
  // "… to X", "… in X": try every such word, the last first ("5 ft 11 in in cm")
  for (let i = words.length - 2; i >= 1; i--) {
    if (/^(?:to|into|as|in)$/i.test(words[i]!)) candidates.push([words.slice(0, i).join(" "), words.slice(i + 1).join(" ")]);
  }
  // the whole thing as an amount ("5 ft 11 in" mustn't read as "5 ft 11, to inches")
  candidates.push([s, null]);
  // "5 ft cm", "2 sq ft square metres": the last one to three words as the target
  for (let k = 1; k <= Math.min(3, words.length - 1); k++) {
    candidates.push([words.slice(0, -k).join(" "), words.slice(-k).join(" ")]);
  }
  for (const [left, right] of candidates) {
    const to = right ? findUnit(right) : null;
    if (right && !to) continue;
    const src = parseAmount(left);
    if (!src) continue;
    if (to && to.category !== src.from.category) continue;
    return { ...src, to };
  }
  return null;
}

function parseAmount(text: string): { value: Dec; from: UnitDef; amount: string } | null {
  const s = text.trim();
  const c = compound(s);
  if (c) return c;
  // split where the number ends and the unit starts: the first place both make sense
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1]!;
    if (!/[\d.) ]/.test(prev) || /[\d\s]/.test(s[i]!)) continue;
    const num = s.slice(0, i).trim();
    const from = findUnit(s.slice(i));
    if (!from || !num) continue;
    try {
      const value = evaluate(num.replace(/−/g, "-")).value;
      return { value, from, amount: num };
    } catch {
      /* try a later split */
    }
  }
  return null;
}

/* ---------------------------------------------------------- presentation -- */

export function formatAmount(d: Dec, opts: { places?: number | null; group?: boolean } = {}): string {
  const group = opts.group ?? true;
  const places = opts.places ?? null;
  if (places !== null && d.m !== 0n) {
    const fixed = formatDec(d, { places, group });
    // don't round something real down to "0.00": show it to 3 significant digits
    if (/^-?0(?:\.0*)?$/.test(fixed)) return formatDec(d, { group, sig: 3 });
    return fixed;
  }
  return formatDec(d, { places, group, sig: 12 });
}

/** "1 ft = 30.48 cm" for the pair, plus the reverse. */
export function rateLine(from: UnitDef, to: UnitDef): string {
  if (from.category === "temperature" || from.inverse || to.inverse) return formulaLine(from, to);
  const one = convert(parseDec("1"), from, to);
  return `1 ${from.symbol} ${one.exact ? "=" : "≈"} ${formatAmount(one.value)} ${to.symbol}`;
}

function formulaLine(from: UnitDef, to: UnitDef): string {
  const key = `${from.id}>${to.id}`;
  const known: Record<string, string> = {
    "c>f": "°F = °C × 9/5 + 32",
    "f>c": "°C = (°F − 32) × 5/9",
    "c>k": "K = °C + 273.15",
    "k>c": "°C = K − 273.15",
    "f>k": "K = (°F − 32) × 5/9 + 273.15",
    "k>f": "°F = (K − 273.15) × 9/5 + 32",
    "mpg>l100km": "L/100 km = 235.214583… ÷ mpg",
    "l100km>mpg": "mpg = 235.214583… ÷ L/100 km",
    "mpgimp>l100km": "L/100 km = 282.480936… ÷ mpg (UK)",
    "l100km>mpgimp": "mpg (UK) = 282.480936… ÷ L/100 km",
    "kmpl>l100km": "L/100 km = 100 ÷ km/L",
    "l100km>kmpl": "km/L = 100 ÷ L/100 km",
  };
  return known[key] ?? "";
}

/* --------------------------------------------------------- widget state -- */

export interface ConverterPair {
  category: UnitCategory;
  from: string;
  to: string;
}

export interface ConverterWidgetSettings {
  convCategory?: UnitCategory;
  convFrom?: string;
  convTo?: string;
  /** What's in the top box, as typed. */
  convAmount?: string;
  /** Recent pairs, newest first. */
  convRecent?: ConverterPair[];
  /** null/"" = automatic. */
  convPlaces?: number | null;
}
