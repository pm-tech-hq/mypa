/**
 * Shopping Lists: lists of things to buy, grouped by where they are in the
 * shop. Everything here is pure (parsing what people type, guessing aisles,
 * merging duplicates, suggesting what to buy again) so the widget and the
 * Assistant agree.
 */

export type AisleId =
  | "produce"
  | "bakery"
  | "dairy"
  | "meat"
  | "frozen"
  | "pantry"
  | "snacks"
  | "drinks"
  | "household"
  | "personal"
  | "baby"
  | "pets"
  | "other";

export const AISLES: { id: AisleId; label: string }[] = [
  { id: "produce", label: "Fruit & veg" },
  { id: "bakery", label: "Bakery" },
  { id: "dairy", label: "Dairy & eggs" },
  { id: "meat", label: "Meat & fish" },
  { id: "frozen", label: "Frozen" },
  { id: "pantry", label: "Pantry" },
  { id: "snacks", label: "Snacks" },
  { id: "drinks", label: "Drinks" },
  { id: "household", label: "Household" },
  { id: "personal", label: "Personal care" },
  { id: "baby", label: "Baby" },
  { id: "pets", label: "Pets" },
  { id: "other", label: "Other" },
];
export const AISLE_IDS = AISLES.map((a) => a.id);
export const aisleLabel = (id: string) => AISLES.find((a) => a.id === id)?.label ?? "Other";
export const isAisle = (v: unknown): v is AisleId => AISLE_IDS.includes(v as AisleId);

export interface ShoppingList {
  id: string;
  name: string;
  sort: number;
  createdAt: number;
}

export interface ShoppingItem {
  id: string;
  listId: string;
  name: string;
  /** As written: "2", "500 g", "2 lb", "a bunch"; "" for none. */
  qty: string;
  aisle: AisleId;
  note: string;
  /** What it costs (the line, not per unit), hundredths; null = unknown. */
  price: number | null;
  checked: boolean;
  checkedAt: number | null;
  createdAt: number;
}

/** What's been bought before (one row per item name), for suggestions and aisle memory. */
export interface ShoppingHistory {
  key: string;
  name: string;
  aisle: AisleId;
  qty: string;
  price: number | null;
  count: number;
  lastAt: number;
}

export interface ShoppingSettings {
  /** The aisle order of your usual shop. */
  aisleOrder: AisleId[];
  /** "Done shopping" offers to log the trip in Expenses in this category. */
  expenseCategory: string;
  logExpense: boolean;
}

export const DEFAULT_SHOPPING_SETTINGS: ShoppingSettings = {
  aisleOrder: [...AISLE_IDS],
  expenseCategory: "groceries",
  logExpense: true,
};

export function cleanShoppingSettings(s: Partial<ShoppingSettings> | null | undefined): ShoppingSettings {
  const d = DEFAULT_SHOPPING_SETTINGS;
  const given = Array.isArray(s?.aisleOrder) ? s.aisleOrder.filter(isAisle) : [];
  const order = [...new Set(given)];
  for (const a of AISLE_IDS) if (!order.includes(a)) order.push(a);
  return {
    aisleOrder: order,
    expenseCategory: typeof s?.expenseCategory === "string" && s.expenseCategory ? s.expenseCategory : d.expenseCategory,
    logExpense: typeof s?.logExpense === "boolean" ? s.logExpense : d.logExpense,
  };
}

/** Per widget: which list it shows and how. */
export interface ShoppingWidgetSettings {
  shopListId: string | null;
  shopGroup: boolean;
  shopCartOpen: boolean;
}

/* --------------------------------------------------------------- names -- */

/** "Tomatoes " → "tomato": one key for singular/plural and case. */
export function itemKey(name: string): string {
  let s = name.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ");
  const last = words.pop() ?? "";
  let w = last;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(?:oes|ches|shes|xes|sses)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  words.push(w);
  s = words.join(" ");
  return s;
}

function tidyName(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

/* --------------------------------------------------------------- aisles -- */

const AISLE_WORDS: Record<Exclude<AisleId, "other">, string[]> = {
  produce: (
    "apple apples banana bananas orange oranges lemon lemons lime limes grape grapes berries strawberries " +
    "blueberries raspberries avocado avocados tomato tomatoes potato potatoes onion onions garlic carrot carrots " +
    "lettuce spinach kale cucumber cucumbers broccoli cauliflower mushroom mushrooms ginger cilantro coriander " +
    "parsley basil mint celery zucchini courgette corn plantain plantains yam yams mango mangoes pineapple " +
    "watermelon melon peach peaches pear pears cabbage salad leeks leek herbs fruit veg vegetables beetroot " +
    "sweet-potato pumpkin squash kiwi cherries plums plum aubergine eggplant okra chillies chili chilli scallions " +
    "spring-onions bell-pepper bell-peppers peppers"
  ).split(" "),
  bakery: "bread bagel bagels bun buns rolls croissant croissants tortilla tortillas wraps pita cake muffins muffin baguette loaf brioche naan".split(
    " ",
  ),
  dairy: "milk cheese cheddar mozzarella parmesan butter yogurt yoghurt cream eggs egg margarine kefir custard feta".split(" "),
  meat: (
    "chicken beef pork lamb turkey bacon sausage sausages ham mince steak steaks fish salmon tuna-steak shrimp prawn " +
    "prawns cod tilapia goat drumsticks wings thighs"
  ).split(" "),
  frozen: "frozen ice-cream ice fries popsicles".split(" "),
  pantry: (
    "rice pasta spaghetti noodles flour sugar salt oil olive-oil vinegar cereal oats granola beans lentils chickpeas " +
    "sauce ketchup mayo mayonnaise mustard honey jam peanut-butter spices paprika cumin stock bouillon soup tinned " +
    "canned tomato-paste coffee tea cocoa yeast baking-powder baking-soda semolina garri couscous quinoa tuna"
  ).split(" "),
  snacks: "crackers chips crisps cookies biscuits nuts peanuts chocolate snacks popcorn candy sweets almonds".split(" "),
  drinks: "water juice soda coke pepsi sprite beer wine sparkling lemonade cider kombucha squash-drink".split(" "),
  household: (
    "detergent dish-soap washing-up bleach sponge sponges trash-bags bin-bags bin-liners foil cling-film " +
    "paper-towels kitchen-roll toilet-paper loo-roll tissues batteries bulb light-bulb bulbs cleaner laundry " +
    "softener dishwasher candles matches"
  ).split(" "),
  personal: (
    "shampoo conditioner toothpaste toothbrush deodorant razor razors lotion sunscreen floss body-wash soap pads " +
    "tampons vitamins medicine paracetamol ibuprofen plasters mouthwash moisturiser moisturizer"
  ).split(" "),
  baby: "diapers nappies wipes formula baby-food".split(" "),
  pets: "dog-food cat-food kibble cat-litter litter treats pet-food".split(" "),
};

/** Where `name` usually is: what you set before, else by its words (longest phrase wins). */
export function guessAisle(name: string, history: ShoppingHistory[] = [], qty = ""): AisleId {
  const key = itemKey(name);
  const known = history.find((h) => h.key === key);
  if (known) return known.aisle;
  // "3 cans of tomatoes" is on the tins shelf, not with the fresh ones
  if (/\b(?:cans?|tins?|jars?)\b/i.test(qty)) return "pantry";
  if (/\bfrozen\b/i.test(name)) return "frozen";
  const text = ` ${name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
  let best: { id: AisleId; len: number } | null = null;
  for (const [id, words] of Object.entries(AISLE_WORDS) as [AisleId, string[]][]) {
    for (const raw of words) {
      const w = raw.replace(/-/g, " ");
      if (text.includes(` ${w} `) && (!best || w.length > best.len)) best = { id, len: w.length };
    }
  }
  return best?.id ?? "other";
}

/* -------------------------------------------------------------- parsing -- */

const UNITS =
  "kg|kgs|g|grams?|lb|lbs|pounds?|oz|l|litres?|liters?|ml|cl|packs?|packets?|bottles?|cans?|tins?|bags?|boxes|box|jars?|dozen|bunch(?:es)?|loaf|loaves|pcs|pieces?|cartons?|rolls?|tubs?|heads?|cloves?|slices?|cups?|crates?|sachets?|m|cm|mm|metres?|meters?|ft|feet|inch(?:es)?|yards?|sheets?|rolls";
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", twelve: "12", half: "½",
};

export interface ParsedItem {
  name: string;
  qty: string;
  note: string;
  price: number | null;
}

function parsePrice(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 1e7 ? Math.round(n * 100) : null;
}

/** "2 lb chicken thighs (skinless) @6.50" → name, qty "2 lb", note, price. */
export function parseItem(text: string): ParsedItem | null {
  let s = text
    .replace(/^\s*(?:(?:[-*•]|\[\s?[xX ]?\]|\d+[.)])\s*)+/, "") // list markers, "- [ ]"
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  let note = "";
  s = s.replace(/\(([^)]*)\)/g, (_m, n: string) => {
    note = note ? `${note}; ${n.trim()}` : n.trim();
    return " ";
  });
  let price: number | null = null;
  s = s.replace(/(?:^|\s)(?:@\s*|[$€£₦¥₹]\s?)(\d+(?:[.,]\d{1,2})?)(?=\s|$)/, (_m, p: string) => {
    price = parsePrice(p);
    return " ";
  });
  s = s.trim();
  let qty = "";
  const unit = new RegExp(`^(\\d+(?:[.,]\\d+)?|\\d+/\\d+|${Object.keys(NUMBER_WORDS).join("|")}|an?)\\s*(${UNITS})?\\b\\s*(?:of\\s+)?`, "i");
  const times = /(?:^|\s)(?:x\s?(\d+)|(\d+)\s?x)(?=\s|$)/i;
  const tail = new RegExp(`\\s(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})?$`, "i");
  const t = times.exec(s);
  if (t) {
    qty = t[1] ?? t[2]!;
    s = s.replace(t[0], " ").trim();
  } else {
    const m = unit.exec(s);
    if (m && (m[2] || /^\d|\//.test(m[1]!) || NUMBER_WORDS[m[1]!.toLowerCase()]) && s.length > m[0].length) {
      const num = NUMBER_WORDS[m[1]!.toLowerCase()] ?? m[1]!;
      qty = m[2] ? `${num} ${m[2].toLowerCase()}` : num;
      s = s.slice(m[0].length);
    } else if (m && /^an?$/i.test(m[1]!) && m[2] && s.length > m[0].length) {
      qty = `a ${m[2].toLowerCase()}`;
      s = s.slice(m[0].length);
    } else {
      const e = tail.exec(s);
      if (e && s.length > e[0].length) {
        qty = e[2] ? `${e[1]} ${e[2].toLowerCase()}` : e[1]!;
        s = s.slice(0, e.index);
      }
    }
  }
  if (/^an?\s+/i.test(s) && !qty) s = s.replace(/^an?\s+/i, "");
  const name = tidyName(s);
  if (!name) return null;
  if (qty === "1") qty = "";
  return { name: name.slice(0, 120), qty: qty.slice(0, 30), note: note.slice(0, 200), price };
}

/** A line, a comma list or a pasted list → items. */
export function parseItems(text: string): ParsedItem[] {
  return text
    .split(/\r?\n|,|;/)
    .map((p) => parseItem(p))
    .filter((p): p is ParsedItem => p !== null);
}

/** Adds two quantities when they can be added ("2" + "3", "1 kg" + "500 g" can't). */
export function addQty(a: string, b: string): string {
  const pa = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(a.trim() || "1");
  const pb = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(b.trim() || "1");
  if (pa && pb && pa[2]!.replace(/s$/, "") === pb[2]!.replace(/s$/, "")) {
    const n = Math.round((Number(pa[1]) + Number(pb[1])) * 100) / 100;
    const u = pa[2] || pb[2];
    return u ? `${n} ${u}` : String(n);
  }
  return b.trim() || a.trim();
}

/* ------------------------------------------------------- merging adds -- */

export type AddOutcome =
  | { kind: "new"; item: ParsedItem; aisle: AisleId }
  | { kind: "more"; id: string; name: string; qty: string; price: number | null }
  | { kind: "back"; id: string; name: string; qty: string };

/** What adding `parsed` to `list` does: a new row, more of an open one, or back from the cart. */
export function planAdds(parsed: ParsedItem[], items: ShoppingItem[], history: ShoppingHistory[]): AddOutcome[] {
  const out: AddOutcome[] = [];
  const pending = new Map<string, AddOutcome>();
  for (const p of parsed) {
    const key = itemKey(p.name);
    const prior = pending.get(key);
    if (prior) {
      if (prior.kind === "new") prior.item.qty = addQty(prior.item.qty, p.qty);
      else prior.qty = addQty(prior.qty, p.qty);
      continue;
    }
    const open = items.find((i) => !i.checked && itemKey(i.name) === key);
    const done = items.find((i) => i.checked && itemKey(i.name) === key);
    let o: AddOutcome;
    if (open) o = { kind: "more", id: open.id, name: open.name, qty: addQty(open.qty, p.qty), price: p.price ?? open.price };
    else if (done) o = { kind: "back", id: done.id, name: done.name, qty: p.qty || done.qty };
    else {
      const h = history.find((x) => x.key === key);
      o = {
        kind: "new",
        item: { ...p, price: p.price ?? h?.price ?? null },
        aisle: guessAisle(p.name, history, p.qty),
      };
    }
    pending.set(key, o);
    out.push(o);
  }
  return out;
}

/* --------------------------------------------------------- suggestions -- */

/** Things you buy again and again that aren't on the list, likeliest first. */
export function buyAgain(history: ShoppingHistory[], items: ShoppingItem[], now: number, max = 8): ShoppingHistory[] {
  const on = new Set(items.filter((i) => !i.checked).map((i) => itemKey(i.name)));
  return history
    .filter((h) => h.count >= 2 && !on.has(h.key))
    .map((h) => {
      const days = (now - h.lastAt) / 86_400_000;
      // bought often, and a while ago but not forgotten
      const score = h.count * (days < 1 ? 0.2 : days > 120 ? 0.3 : 1) + Math.min(days, 21) / 7;
      return { h, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.h);
}

/** Past items starting with (or containing) what's typed, for the add box. */
export function completions(text: string, history: ShoppingHistory[], items: ShoppingItem[], max = 6): ShoppingHistory[] {
  const q = text.split(/,|\n/).pop()!.trim().toLowerCase();
  if (q.length < 2) return [];
  const on = new Set(items.filter((i) => !i.checked).map((i) => itemKey(i.name)));
  const starts = history.filter((h) => h.name.toLowerCase().startsWith(q));
  const has = history.filter((h) => !h.name.toLowerCase().startsWith(q) && h.name.toLowerCase().includes(q));
  return [...starts.sort((a, b) => b.count - a.count), ...has.sort((a, b) => b.count - a.count)]
    .filter((h) => !on.has(h.key))
    .slice(0, max);
}

/* ------------------------------------------------------------- display -- */

/** The list as plain text, ready to paste into a message. */
export function listAsText(
  list: ShoppingList,
  items: ShoppingItem[],
  order: AisleId[],
  opts: { group: boolean; money?: (c: number) => string },
): string {
  const open = items.filter((i) => !i.checked);
  const line = (i: ShoppingItem) =>
    `- ${i.name}${i.qty ? ` (${i.qty})` : ""}${i.note ? ` – ${i.note}` : ""}${i.price !== null && opts.money ? ` ${opts.money(i.price)}` : ""}`;
  const out = [list.name];
  if (!opts.group) out.push(...open.map(line));
  else
    for (const a of order) {
      const here = open.filter((i) => i.aisle === a);
      if (!here.length) continue;
      out.push("", `${aisleLabel(a)}:`, ...here.map(line));
    }
  return out.join("\n");
}

export function totalOf(items: ShoppingItem[]): { total: number; priced: number } {
  let total = 0;
  let priced = 0;
  for (const i of items) {
    if (i.price === null) continue;
    total += i.price;
    priced += 1;
  }
  return { total, priced };
}
