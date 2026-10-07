import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  /** Accessible name for the field while editing, e.g. "Task title". */
  label: string;
  /** Start in edit mode (used right after creating something). */
  autoEdit?: boolean;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

/** Text that turns into an input on click. Enter or blur saves, Escape
 *  cancels, an empty value is ignored. */
export function EditableText({
  value,
  onSave,
  className,
  label,
  autoEdit,
  onEditStart,
  onEditEnd,
}: Props) {
  const [editing, setEditing] = useState(Boolean(autoEdit));
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);

  const begin = () => {
    setDraft(value);
    setEditing(true);
    onEditStart?.();
  };

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  const close = (save: boolean) => {
    const next = draft.trim();
    if (save && next && next !== value) onSave(next);
    setEditing(false);
    onEditEnd?.();
  };

  if (editing)
    return (
      <input
        ref={input}
        className={`editable editable--on ${className ?? ""}`}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => close(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") close(true);
          else if (e.key === "Escape") {
            e.stopPropagation();
            close(false);
          }
        }}
      />
    );

  return (
    <span
      className={`editable ${className ?? ""}`}
      role="button"
      tabIndex={0}
      title="Click to edit"
      onClick={begin}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          begin();
        }
      }}
    >
      {value}
    </span>
  );
}
