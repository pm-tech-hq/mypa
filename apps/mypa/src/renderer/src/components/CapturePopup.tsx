import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Check, ExternalLink } from "lucide-react";

import { useStore } from "../lib/store";
import { CaptureComposer, KIND_ICON, type Saved } from "./CaptureComposer";
import "../styles/capture.css";

/**
 * The box the global shortcut opens (its own small window, see main/capture.ts).
 * Saving shows where it went for a moment, then the box tucks itself away.
 */
export function CapturePopup() {
  const { snapshot } = useStore();
  const [focusKey, setFocusKey] = useState(1);
  const [done, setDone] = useState<Saved | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.documentElement.classList.add("is-capture-window");
    return window.mypa.db.onCaptureShown(() => {
      window.clearTimeout(hideTimer.current);
      setDone(null);
      setFocusKey((k) => k + 1);
    });
  }, []);

  // the window is as tall as the card (plus room for its shadow)
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const fit = () => window.mypa.db.resizeCapture(el.offsetHeight + 40);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [snapshot === null]);

  const hide = () => {
    window.clearTimeout(hideTimer.current);
    setDone(null);
    window.mypa.db.hideCapture();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && done) hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!snapshot) return <div className="cappop" />;

  const DoneIcon = done ? KIND_ICON[done.kind] : Check;
  return (
    <div className="cappop">
      <div className="cappop__card" ref={card}>
        <div className="cappop__head">
          <span className="cappop__brand">Quick Capture</span>
          <button
            type="button"
            className="cappop__open"
            onClick={() => window.mypa.db.openMainFromCapture()}
            title="Open myPA"
          >
            Open myPA <ExternalLink size={12} />
          </button>
        </div>
        {done ? (
          <div className="cappop__done" role="status">
            <span className="cappop__done-icon">
              <DoneIcon size={16} />
            </span>
            <div>
              <p className="cappop__done-title">Saved</p>
              <p className="cappop__done-where">{done.summary}</p>
            </div>
          </div>
        ) : (
          <CaptureComposer
            focusKey={focusKey}
            onEscape={hide}
            onSaved={(s) => {
              setDone(s);
              hideTimer.current = window.setTimeout(hide, 1400);
            }}
            footer={<span className="capc__why">Enter saves · Shift+Enter new line · Esc closes</span>}
          />
        )}
      </div>
    </div>
  );
}
