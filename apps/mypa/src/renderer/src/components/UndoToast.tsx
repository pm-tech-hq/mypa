import { X } from "lucide-react";

/** The "Deleted … · Undo" bar pinned to the bottom of a widget. */
export function UndoToast({
  label,
  onUndo,
  onDismiss,
}: {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast__label">{label}</span>
      <button type="button" className="undo-toast__undo" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="undo-toast__close" aria-label="Dismiss" onClick={onDismiss}>
        <X size={13} />
      </button>
    </div>
  );
}
