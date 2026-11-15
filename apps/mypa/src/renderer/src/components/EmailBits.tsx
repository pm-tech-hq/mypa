/** Small pieces the Email widget's list and reader share. */
import { useState } from "react";

import { Tags } from "lucide-react";

import type { EmailAddress } from "../../../shared/email";
import { avatarHue, initials } from "../lib/email";

/** Sets the hue a sender's or account's colour is made from. */
export const hueStyle = (hue: number) => ({ "--hue": hue }) as React.CSSProperties;

const ACCOUNT_HUES = [221, 152, 28, 280, 350, 190];

/** Each account keeps its own colour, by its place in the list. */
export function accountHue(accounts: { id: string }[], id: string): number {
  return ACCOUNT_HUES[Math.max(0, accounts.findIndex((a) => a.id === id)) % ACCOUNT_HUES.length]!;
}

export function Avatar({ person }: { person: EmailAddress }) {
  return (
    <span className="email__avatar" style={hueStyle(avatarHue(person))} aria-hidden="true">
      {initials(person)}
    </span>
  );
}

/** A small menu for putting emails in a category, a new one, or none. */
export function CategoryPicker({
  choices,
  current,
  onPick,
}: {
  choices: string[];
  current: string | null;
  onPick: (c: string | null) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  if (naming) {
    return (
      <form
        className="email__cat-new"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim().slice(0, 40);
          setNaming(false);
          setName("");
          if (n) onPick(n);
        }}
      >
        <input
          autoFocus
          aria-label="New category"
          placeholder="New category"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setNaming(false)}
          onKeyDown={(e) => e.key === "Escape" && setNaming(false)}
        />
      </form>
    );
  }
  return (
    <label className={`email__cat-pick${current ? " has-value" : ""}`} title="Category">
      <Tags size={13} aria-hidden="true" />
      {current && <span className="email__cat-name">{current}</span>}
      <select
        aria-label="Category"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__none") onPick(null);
          else if (v === "__new") setNaming(true);
          else if (v) onPick(v);
        }}
      >
        <option value="">Category…</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c === current ? `✓ ${c}` : c}
          </option>
        ))}
        <option value="__new">New category…</option>
        {current && <option value="__none">Remove category</option>}
      </select>
    </label>
  );
}
