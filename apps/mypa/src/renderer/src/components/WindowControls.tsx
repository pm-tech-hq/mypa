import { useEffect, useState } from "react";

import { Copy, Minus, Square, X } from "lucide-react";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.mypa.win.isMaximized().then(setMaximized);
    return window.mypa.win.onMaximizeChange(setMaximized);
  }, []);

  return (
    <div className="win-controls">
      <button
        type="button"
        className="win-btn"
        aria-label="Minimise"
        onClick={() => window.mypa.win.minimize()}
      >
        <Minus size={14} strokeWidth={1.5} aria-hidden />
      </button>

      <button
        type="button"
        className="win-btn"
        aria-label={maximized ? "Restore" : "Maximise"}
        onClick={() => window.mypa.win.toggleMaximize()}
      >
        {maximized ? (
          <Copy size={12} strokeWidth={1.5} aria-hidden />
        ) : (
          <Square size={11} strokeWidth={1.5} aria-hidden />
        )}
      </button>

      <button
        type="button"
        className="win-btn win-btn--close"
        aria-label="Close"
        onClick={() => window.mypa.win.close()}
      >
        <X size={15} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
