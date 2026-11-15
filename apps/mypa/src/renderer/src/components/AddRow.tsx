import type { ReactNode } from "react";

import { CornerDownLeft, Plus } from "lucide-react";

/** The inline "add" field shared by tasks, goals and goal breakdowns.
 *  Submits on Enter or by clicking the return button that appears once
 *  there's something to add. */
export function AddRow({
  value,
  placeholder,
  onChange,
  onSubmit,
  children,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  /** Called with a non-empty draft; the caller trims, saves and clears it. */
  onSubmit: () => void;
  children?: ReactNode;
}) {
  const ready = value.trim().length > 0;
  return (
    <div className="addrow">
      <label className="addrow__field">
        <Plus size={14} className="addrow__plus" aria-hidden />
        <input
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing || !ready) return;
            e.preventDefault();
            onSubmit();
          }}
        />
        {ready && (
          <button
            type="button"
            className="addrow__submit"
            aria-label="Add"
            title="Add (Enter)"
            onClick={(e) => {
              // Inside a <label>: stop the click from refocusing the input
              // twice and keep focus there for the next entry.
              e.preventDefault();
              onSubmit();
              (e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement | null)?.focus();
            }}
          >
            <CornerDownLeft size={11} aria-hidden />
          </button>
        )}
      </label>
      {children}
    </div>
  );
}
