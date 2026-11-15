/**
 * Personal Memory: short facts about the user (people, preferences, routines,
 * places) that the Assistant may use. Every record can be seen, corrected,
 * hidden from the Assistant or deleted; records the Assistant learned in chat
 * keep what the user said, so "why does it know this?" always has an answer.
 */

export type MemoryKind = "about" | "people" | "preference" | "routine" | "place" | "other";

export const MEMORY_KINDS: { id: MemoryKind; label: string; hint: string }[] = [
  { id: "about", label: "About you", hint: "Your name, work, what you're like" },
  { id: "people", label: "People", hint: "Family, friends, colleagues, birthdays" },
  { id: "preference", label: "Likes and dislikes", hint: "Food, how you like things done" },
  { id: "routine", label: "Routines", hint: "When you work, train, sleep" },
  { id: "place", label: "Places", hint: "Home, work, places you go" },
  { id: "other", label: "Other", hint: "Anything else" },
];

export const isMemoryKind = (v: unknown): v is MemoryKind => MEMORY_KINDS.some((k) => k.id === v);

export const memoryKindLabel = (k: MemoryKind) => MEMORY_KINDS.find((x) => x.id === k)?.label ?? "Other";

export interface MemoryRecord {
  id: string;
  text: string;
  kind: MemoryKind;
  /** Who wrote it: typed in the widget, or learned by the Assistant in chat. */
  source: "you" | "assistant";
  /** For learned ones: what the user said at the time. */
  context: string;
  /** Off = kept here but never shown to the Assistant. */
  assistantCanUse: boolean;
  pinned: boolean;
  /** Learned ones start unreviewed until the user keeps or fixes them. */
  reviewed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryWidgetSettings {
  memFilter?: MemoryKind | "all" | "review" | "hidden";
}

export const MEMORY_TEXT_MAX = 400;
export const MEMORY_CONTEXT_MAX = 300;

export function cleanMemoryText(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_TEXT_MAX);
}

/** A first guess at the kind, from the words. The user can always change it. */
export function guessKind(text: string): MemoryKind {
  const t = ` ${text.toLowerCase()} `;
  if (
    /\b(wife|husband|partner|girlfriend|boyfriend|fianc[eé]e?|son|daughter|kids?|children|mum|mom|mother|dad|father|parents?|sister|brother|sibling|aunt|uncle|cousin|niece|nephew|grand(ma|pa|mother|father)|friend|boss|manager|colleague|coworker|co-worker|team ?mate|client|doctor|dentist|neighbou?r|in-laws?)\b/.test(
      t,
    ) ||
    /'s birthday|\bbirthday is\b/.test(t)
  )
    return "people";
  if (/\b(prefer|prefers|like|likes|love|loves|hate|hates|can'?t stand|don'?t like|dislike|favou?rite|allergic|allergy|vegetarian|vegan|halal|kosher|gluten|lactose|intolerant|rather)\b/.test(t))
    return "preference";
  if (/\b(live|lives|living|address|home is|office is|based in|moved to|from)\b/.test(t))
    return "place";
  if (/\b(every|usually|always|never|each|weekdays?|weekends?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|mornings?|evenings?|nights?|wake|sleep|bed ?time|commute|gym|run|train)\b/.test(t))
    return "routine";
  if (/\b(i am|i'?m|my name|call me|i work|my job|i study|born|my pronouns|years old)\b/.test(t)) return "about";
  return "other";
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** Same fact said again ("My sister is Ada" / "my sister is ada."). */
export function sameMemory(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  const sx = new Set(x);
  const sy = new Set(y);
  let both = 0;
  for (const w of sx) if (sy.has(w)) both++;
  return both / (sx.size + sy.size - both) >= 0.85;
}

/** Records matching a search, best first; every word must appear (prefixes count). */
export function searchMemories(list: MemoryRecord[], query: string): MemoryRecord[] {
  const q = words(query);
  if (!q.length) return list;
  const scored: { m: MemoryRecord; score: number }[] = [];
  for (const m of list) {
    const w = words(`${m.text} ${memoryKindLabel(m.kind)}`);
    let score = 0;
    let all = true;
    for (const term of q) {
      if (w.includes(term)) score += 2;
      else if (w.some((x) => x.startsWith(term))) score += 1;
      else all = false;
    }
    if (all) scored.push({ m, score: score + (m.pinned ? 0.5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt).map((s) => s.m);
}

/** Pinned first, then the newest. */
export function sortMemories(list: MemoryRecord[]): MemoryRecord[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** The short id the Assistant sees (and may pass back). */
export const shortId = (id: string) => id.slice(0, 8);

/**
 * What goes in the Assistant's instructions: every record it may use, pinned
 * and newest first, within a size budget. Hidden ones never leave.
 */
export function memoryPrompt(list: MemoryRecord[], budget = 3000): { text: string; shown: number; left: number } {
  const usable = sortMemories(list.filter((m) => m.assistantCanUse));
  const lines: string[] = [];
  let size = 0;
  for (const m of usable) {
    const line = `- [${shortId(m.id)}] (${memoryKindLabel(m.kind)}) ${m.text}`;
    if (size + line.length > budget && lines.length) break;
    lines.push(line);
    size += line.length + 1;
  }
  return { text: lines.join("\n"), shown: lines.length, left: usable.length - lines.length };
}
