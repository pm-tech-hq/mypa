import type { KeyboardEvent, ReactNode } from "react";

import { CornerDownLeft, Plus } from "lucide-react";

/** The inline "add" field shared by tasks, goals and goal breakdowns. */
export function AddRow({
  value,
  placeholder,
  onChange,
  onKeyDown,
  children,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  children?: ReactNode;
}) {
  return (
    <div className="addrow">
      <label className="addrow__field">
        <Plus size={14} className="addrow__plus" aria-hidden />
        <input
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {value.trim() && (
          <kbd className="addrow__kbd" aria-hidden>
            <CornerDownLeft size={11} />
          </kbd>
        )}
      </label>
      {children}
    </div>
  );
}
