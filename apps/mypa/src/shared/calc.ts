/**
 * Calculator engine. Numbers are exact decimals (a BigInt and a power of ten),
 * so 0.1 + 0.2 is 0.3 and 9007199254740993 + 1 stays exact. + − × and whole
 * powers are exact; division and square roots are worked to 40 significant
 * digits; trig, logs and fractional powers fall back to floating point and are
 * marked inexact. Results are shown rounded to 15 significant digits.
 */

/* ------------------------------------------------------------- decimals -- */

/** value = m × 10^e */
export interface Dec {
  m: bigint;
  e: number;
}

const PREC = 40;
const MAX_DIGITS = 2000;

export class CalcError extends Error {}

function norm(m: bigint, e: number): Dec {
  if (m === 0n) return { m: 0n, e: 0 };
  while (m % 10n === 0n) {
    m /= 10n;
    e++;
  }
  return { m, e };
}

const ZERO: Dec = { m: 0n, e: 0 };
const ONE: Dec = { m: 1n, e: 0 };
const HUNDRED: Dec = { m: 1n, e: 2 };

function digits(m: bigint): number {
  return (m < 0n ? -m : m).toString().length;
}

const pow10 = (n: number) => 10n ** BigInt(n);

function guard(d: Dec): Dec {
  if (d.m !== 0n && digits(d.m) + d.e > MAX_DIGITS) throw new CalcError("That number is too big.");
  // far too small to matter: treat as 0
  if (d.m !== 0n && digits(d.m) + d.e < -MAX_DIGITS) return ZERO;
  return d;
}

/** Rounds to `sig` significant digits, halves away from zero. */
export function roundSig(d: Dec, sig: number): Dec {
  const n = digits(d.m);
  if (n <= sig) return d;
  return roundAt(d, d.e + (n - sig));
}

/** Rounds so the last kept digit is at 10^exp. */
function roundAt(d: Dec, exp: number): Dec {
  if (d.e >= exp) return d;
  const drop = exp - d.e;
  const div = pow10(drop);
  const neg = d.m < 0n;
  const a = neg ? -d.m : d.m;
  let q = a / div;
  const r = a % div;
  const half = div / 2n;
  // halves round away from zero, as people expect (0.125 → 0.13)
  if (r >= half && div > 1n) q += 1n;
  return norm(neg ? -q : q, exp);
}

function add(a: Dec, b: Dec): Dec {
  const e = Math.min(a.e, b.e);
  return guard(norm(a.m * pow10(a.e - e) + b.m * pow10(b.e - e), e));
}

const neg = (a: Dec): Dec => ({ m: -a.m, e: a.e });
const sub = (a: Dec, b: Dec) => add(a, neg(b));
const mul = (a: Dec, b: Dec): Dec => guard(norm(a.m * b.m, a.e + b.e));

function div(a: Dec, b: Dec): Dec {
  if (b.m === 0n) throw new CalcError("Can't divide by zero.");
  if (a.m === 0n) return ZERO;
  // scale a so the quotient has PREC + 2 digits, then round
  const shift = Math.max(0, PREC + 2 + digits(b.m) - digits(a.m));
  const q = (a.m * pow10(shift)) / b.m;
  const r = (a.m * pow10(shift)) % b.m;
  // a sticky digit keeps rounding honest when the division wasn't exact
  const m = q * 10n + (r === 0n ? 0n : q < 0n || (q === 0n && (a.m < 0n) !== (b.m < 0n)) ? -1n : 1n);
  return guard(roundSig(norm(m, a.e - b.e - shift - 1), PREC));
}

function cmp(a: Dec, b: Dec): number {
  const d = sub(a, b).m;
  return d === 0n ? 0 : d < 0n ? -1 : 1;
}

const isInt = (a: Dec) => a.e >= 0 || a.m % pow10(-a.e) === 0n;

function toBigInt(a: Dec): bigint {
  return a.e >= 0 ? a.m * pow10(a.e) : a.m / pow10(-a.e);
}

export function parseDec(s: string): Dec {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s.trim());
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new CalcError(`“${s}” isn't a number.`);
  const frac = m[3] ?? "";
  const mant = BigInt((m[2] || "0") + frac);
  return guard(norm(m[1] === "-" ? -mant : mant, Number(m[4] ?? 0) - frac.length));
}

function fromNumber(x: number): Dec {
  if (!Number.isFinite(x)) throw new CalcError(Number.isNaN(x) ? "That isn't a real number." : "That number is too big.");
  // 15 digits: what a double can be trusted to
  return roundSig(parseDec(x.toPrecision(17)), 15);
}

export function toNumber(a: Dec): number {
  return Number(`${a.m}e${a.e}`);
}

function sqrt(a: Dec): Dec {
  if (a.m < 0n) throw new CalcError("The square root of a negative number isn't a real number.");
  if (a.m === 0n) return ZERO;
  // make the exponent even and leave room for PREC digits
  let e = a.e;
  let m = a.m;
  const want = 2 * (PREC + 2) - digits(m);
  let shift = Math.max(0, want);
  if ((e - shift) % 2 !== 0) shift++;
  m *= pow10(shift);
  e -= shift;
  // integer square root by Newton's method
  let x = BigInt(Math.floor(Math.sqrt(Number(m)))) || 1n;
  if (digits(m) > 300) x = pow10(Math.floor(digits(m) / 2));
  for (;;) {
    const y = (x + m / x) / 2n;
    if (y >= x) break;
    x = y;
  }
  while (x * x > m) x--;
  while ((x + 1n) * (x + 1n) <= m) x++;
  const exact = x * x === m;
  return roundSig(norm(exact ? x * 10n : x * 10n + 1n, e / 2 - 1), PREC);
}

function powInt(a: Dec, n: bigint): Dec {
  if (n < 0n) return div(ONE, powInt(a, -n));
  if (n > 100_000n && a.m !== 1n && a.m !== -1n && a.m !== 0n) throw new CalcError("That number is too big.");
  let result = ONE;
  let base = a;
  let k = n;
  while (k > 0n) {
    if (k & 1n) result = mul(result, base);
    k >>= 1n;
    if (k) base = mul(base, base);
    // keep it from growing without bound for long fractions
    if (digits(result.m) > PREC * 4) result = roundSig(result, PREC * 2);
    if (digits(base.m) > PREC * 4) base = roundSig(base, PREC * 2);
  }
  return result;
}

const PI = parseDec("3.141592653589793238462643383279502884197");
const E = parseDec("2.718281828459045235360287471352662497757");

/* --------------------------------------------------------------- parser -- */

export type AngleUnit = "deg" | "rad";

type Tok =
  | { t: "num"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" };

const OPS = "+-*/^%!";

function tokenize(src: string): Tok[] {
  const s = src
    // "3 x 4": an x between numbers is a times sign
    .replace(/(?<=[\d.)]\s*)[xX](?=\s*[\d.(])/g, "*")
    .replace(/×/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/\*\*/g, "^")
    .replace(/π/g, " pi ")
    .replace(/√/g, " sqrt ")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    // 1,234,567.89 → 1234567.89 (commas only as thousands separators)
    .replace(/\d{1,3}(?:,\d{3})+(?!\d)/g, (g) => g.replace(/,/g, ""));
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+(?![a-zA-Z]))?/.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[a-zA-Z]+/.exec(s.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if (c === "(" || c === "[") out.push({ t: "(" });
    else if (c === ")" || c === "]") out.push({ t: ")" });
    else if (OPS.includes(c)) out.push({ t: "op", v: c });
    else throw new CalcError(`“${c}” isn't something I can calculate with.`);
    i++;
  }
  return out;
}

const FUNCS = new Set([
  "sqrt",
  "cbrt",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "ln",
  "log",
  "exp",
  "abs",
  "round",
  "floor",
  "ceil",
]);
const CONSTS = new Set(["pi", "e", "ans"]);

interface Ctx {
  angle: AngleUnit;
  ans: Dec | null;
  exact: boolean;
}

/** A parsed value, remembering whether it was written as a bare percentage. */
interface Val {
  d: Dec;
  pct?: boolean;
}

class Parser {
  i = 0;
  constructor(
    private toks: Tok[],
    private ctx: Ctx,
  ) {}

  peek(): Tok | undefined {
    return this.toks[this.i];
  }

  isOp(v: string): boolean {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }

  parse(): Dec {
    if (this.toks.length === 0) throw new CalcError("Type a sum.");
    const v = this.expr();
    if (this.i < this.toks.length) {
      const t = this.peek()!;
      throw new CalcError(t.t === ")" ? "There's a “)” without a “(”." : "That doesn't look like a complete sum.");
    }
    return v.d;
  }

  /** a + b, a − b, with a + b% meaning a plus b percent of a. */
  expr(): Val {
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const right = this.term();
      const r = right.pct ? mul(left.d, right.d) : right.d;
      left = { d: op === "+" ? add(left.d, r) : sub(left.d, r) };
    }
    return left;
  }

  /** a × b, a ÷ b, and implicit multiplication: 2(3), 2pi, (1)(2). */
  term(): Val {
    let left = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = (this.toks[this.i++] as { v: string }).v;
        const right = this.unary();
        left = { d: op === "*" ? mul(left.d, right.d) : div(left.d, right.d) };
        continue;
      }
      // "x% of y"
      const t = this.peek();
      if (t?.t === "id" && t.v === "of") {
        this.i++;
        const right = this.unary();
        left = { d: mul(left.d, right.d) };
        continue;
      }
      if (t && (t.t === "(" || t.t === "num" || (t.t === "id" && t.v !== "of"))) {
        const right = this.unary();
        left = { d: mul(left.d, right.d) };
        continue;
      }
      return left;
    }
  }

  unary(): Val {
    if (this.isOp("-")) {
      this.i++;
      const v = this.unary();
      return { d: neg(v.d), pct: v.pct };
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  /** Right-associative: 2^3^2 = 2^9. Binds tighter than unary minus: −2^2 = −4. */
  power(): Val {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.i++;
      const exp = this.unary();
      return { d: this.pow(base.d, exp.d) };
    }
    return base;
  }

  pow(a: Dec, b: Dec): Dec {
    if (isInt(b)) {
      if (a.m === 0n && b.m < 0n) throw new CalcError("Can't divide by zero.");
      return powInt(a, toBigInt(b));
    }
    if (a.m < 0n) throw new CalcError("A negative number to a fractional power isn't a real number.");
    if (cmp(b, { m: 5n, e: -1 }) === 0) return sqrt(a);
    this.ctx.exact = false;
    return fromNumber(Math.pow(toNumber(a), toNumber(b)));
  }

  postfix(): Val {
    let v = this.primary();
    for (;;) {
      if (this.isOp("!")) {
        this.i++;
        v = { d: factorial(v.d) };
      } else if (this.isOp("%")) {
        this.i++;
        v = { d: div(v.d, HUNDRED), pct: true };
      } else return v;
    }
  }

  primary(): Val {
    const t = this.toks[this.i++];
    if (!t) throw new CalcError("That doesn't look like a complete sum.");
    if (t.t === "num") return { d: parseDec(t.v) };
    if (t.t === "(") {
      const v = this.expr();
      // a missing ")" at the very end is forgiven, like most calculators
      if (this.peek()?.t === ")") this.i++;
      else if (this.i < this.toks.length) throw new CalcError("A “(” is never closed.");
      return { d: v.d };
    }
    if (t.t === "id") {
      if (CONSTS.has(t.v)) {
        if (t.v === "pi") return { d: PI };
        if (t.v === "e") return { d: E };
        if (!this.ctx.ans) throw new CalcError("There's no previous answer yet.");
        return { d: this.ctx.ans };
      }
      if (FUNCS.has(t.v)) {
        // sqrt 16 and sqrt(16) both work; the bare form takes one power
        const arg = this.peek()?.t === "(" ? this.postfix() : this.power();
        return { d: this.fn(t.v, arg.d) };
      }
      throw new CalcError(`I don't know “${t.v}”.`);
    }
    throw new CalcError(t.t === ")" ? "There's a “)” without a “(”." : "That doesn't look like a complete sum.");
  }

  fn(name: string, x: Dec): Dec {
    switch (name) {
      case "sqrt":
        return sqrt(x);
      case "abs":
        return x.m < 0n ? neg(x) : x;
      case "round":
        return roundAt(x, 0);
      case "floor": {
        const r = roundAt(x, 0);
        return cmp(r, x) > 0 ? sub(r, ONE) : r;
      }
      case "ceil": {
        const r = roundAt(x, 0);
        return cmp(r, x) < 0 ? add(r, ONE) : r;
      }
    }
    const wasExact = this.ctx.exact;
    this.ctx.exact = false;
    const n = toNumber(x);
    const deg = this.ctx.angle === "deg";
    const toRad = (v: number) => (deg ? (v * Math.PI) / 180 : v);
    const fromRad = (v: number) => (deg ? (v * 180) / Math.PI : v);
    switch (name) {
      case "cbrt":
        return fromNumber(Math.cbrt(n));
      case "sin":
      case "cos":
      case "tan": {
        if (deg) {
          const exact = exactTrig(name, x);
          if (exact) {
            this.ctx.exact = wasExact;
            return exact;
          }
        }
        const r = name === "sin" ? Math.sin(toRad(n)) : name === "cos" ? Math.cos(toRad(n)) : Math.tan(toRad(n));
        if (name === "tan" && Math.abs(r) > 1e15) throw new CalcError("tan isn't defined there.");
        return fromNumber(Math.abs(r) < 1e-15 ? 0 : r);
      }
      case "asin":
      case "acos":
        if (n < -1 || n > 1) throw new CalcError(`${name} only takes numbers from −1 to 1.`);
        return fromNumber(fromRad(name === "asin" ? Math.asin(n) : Math.acos(n)));
      case "atan":
        return fromNumber(fromRad(Math.atan(n)));
      case "ln":
      case "log": {
        if (n <= 0) throw new CalcError("Logs only take numbers above zero.");
        if (name === "log" && x.m === 1n) {
          this.ctx.exact = wasExact;
          return { m: BigInt(x.e), e: 0 };
        }
        return fromNumber(name === "ln" ? Math.log(n) : Math.log10(n));
      }
      case "exp":
        return fromNumber(Math.exp(n));
    }
    throw new CalcError(`I don't know “${name}”.`);
  }
}

/** sin/cos/tan of whole-degree angles with exact answers (0, ±½, ±1). */
function exactTrig(name: string, x: Dec): Dec | null {
  if (!isInt(x)) return null;
  let a = Number(toBigInt(x) % 360n);
  if (a < 0) a += 360;
  const sin: Record<number, Dec> = { 0: ZERO, 30: { m: 5n, e: -1 }, 90: ONE, 150: { m: 5n, e: -1 }, 180: ZERO, 210: { m: -5n, e: -1 }, 270: { m: -1n, e: 0 }, 330: { m: -5n, e: -1 } };
  if (name === "sin") return sin[a] ?? null;
  if (name === "cos") return sin[(450 - a) % 360] ?? null;
  if (a === 90 || a === 270) throw new CalcError("tan isn't defined there.");
  const tan: Record<number, Dec> = { 0: ZERO, 45: ONE, 135: { m: -1n, e: 0 }, 180: ZERO, 225: ONE, 315: { m: -1n, e: 0 } };
  return tan[a] ?? null;
}

function factorial(x: Dec): Dec {
  if (!isInt(x) || x.m < 0n) throw new CalcError("Factorial (!) only takes whole numbers from 0 up.");
  const n = toBigInt(x);
  if (n > 3000n) throw new CalcError("That number is too big.");
  let r = 1n;
  for (let k = 2n; k <= n; k++) r *= k;
  return norm(r, 0);
}

/* --------------------------------------------------------------- public -- */

export interface CalcResult {
  value: Dec;
  /** False when floating point was involved (trig, logs, fractional powers). */
  exact: boolean;
}

export function evaluate(src: string, opts: { angle?: AngleUnit; ans?: Dec | null } = {}): CalcResult {
  const ctx: Ctx = { angle: opts.angle ?? "deg", ans: opts.ans ?? null, exact: true };
  const toks = tokenize(src.replace(/=\s*$/, ""));
  const value = new Parser(toks, ctx).parse();
  return { value, exact: ctx.exact };
}

/** Like evaluate, but never throws: null for anything that isn't a finished sum. */
export function tryEvaluate(src: string, opts: { angle?: AngleUnit; ans?: Dec | null } = {}): CalcResult | null {
  try {
    return evaluate(src, opts);
  } catch {
    return null;
  }
}

export interface FormatOptions {
  /** null = automatic (up to 15 significant digits). */
  places?: number | null;
  /** Thousands separators. */
  group?: boolean;
  /** Significant digits shown in automatic mode. */
  sig?: number;
}

function groupInt(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * For display. Whole numbers up to 21 digits are shown in full; anything
 * bigger or smaller than 1e-9 uses scientific notation (1.5e+25).
 */
export function formatDec(d: Dec, opts: FormatOptions = {}): string {
  const sig = opts.sig ?? 15;
  const group = opts.group ?? true;
  // whole numbers are exact: show every digit (up to 21) rather than rounding
  const whole = opts.places == null && isInt(d) && digits(d.m) + Math.max(d.e, 0) <= 21;
  let v = opts.places != null ? roundAt(d, -opts.places) : whole ? d : roundSig(d, sig);
  if (v.m === 0n) v = ZERO;
  const n = digits(v.m);
  const mag = n + v.e; // digits before the point
  if (v.m !== 0n && (mag > 21 || mag < -8)) {
    const r = roundSig(v, Math.min(sig, 15));
    const s = (r.m < 0n ? -r.m : r.m).toString();
    const exp = s.length - 1 + r.e;
    const mant = s.length > 1 ? `${s[0]}.${s.slice(1)}` : s;
    return `${r.m < 0n ? "-" : ""}${mant}e${exp >= 0 ? "+" : ""}${exp}`;
  }
  const negative = v.m < 0n;
  const abs = (negative ? -v.m : v.m).toString();
  let int: string;
  let frac: string;
  if (v.e >= 0) {
    int = abs + "0".repeat(v.e);
    frac = "";
  } else {
    const padded = abs.padStart(-v.e + 1, "0");
    int = padded.slice(0, padded.length + v.e);
    frac = padded.slice(padded.length + v.e);
  }
  if (opts.places != null && opts.places > 0) frac = frac.padEnd(opts.places, "0");
  return `${negative ? "-" : ""}${group ? groupInt(int) : int}${frac ? `.${frac}` : ""}`;
}

/** Plain, machine-readable (no grouping): what Copy and `ans` use. */
export function plainDec(d: Dec): string {
  return formatDec(d, { group: false, sig: 15 });
}

/** Serialise exactly (for keeping `ans` between sessions). */
export function decToString(d: Dec): string {
  return `${d.m}e${d.e}`;
}

export function decFromString(s: string | null | undefined): Dec | null {
  if (!s) return null;
  const m = /^(-?\d+)e(-?\d+)$/.exec(s);
  return m ? { m: BigInt(m[1]!), e: Number(m[2]) } : null;
}

/* --------------------------------------------------------- widget state -- */

export interface CalcHistoryEntry {
  expr: string;
  /** Exact result, `decToString` form. */
  value: string;
  exact: boolean;
  at: number;
}

export interface CalcWidgetSettings {
  calcHistory?: CalcHistoryEntry[];
  calcAngle?: AngleUnit;
  /** null/"" = automatic. */
  calcPlaces?: number | null;
  calcGroup?: boolean;
  calcScientific?: boolean;
  calcKeypad?: boolean;
}

export const CALC_HISTORY_MAX = 50;

/* ------------------------------------------- arithmetic for other engines -- */

export const decAdd = add;
export const decSub = sub;
export const decMul = mul;
export const decDiv = div;
export const decCmp = cmp;
export const decNeg = neg;
export const DEC_PI = PI;
