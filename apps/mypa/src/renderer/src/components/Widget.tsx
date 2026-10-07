import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Settings, X } from "lucide-react";

import { widgetIcon } from "../lib/market";
import { useStore } from "../lib/store";
import { widgetDisplayTitle, widgetKindMeta } from "../lib/widgetKinds";
import { cursorFor, resolveRect, type Handle, type Rect } from "../lib/widgets";
import type { WidgetRow } from "../../../shared/types";
import { BlankWidget } from "./BlankWidget";
import { CalendarWidget } from "./CalendarWidget";
import { CustomWidget } from "./CustomWidget";
import { TrustBadge } from "./TrustBadge";
import { TodoList } from "./TodoList";
import { TranscribeWidget } from "./TranscribeWidget";
import { TutorWidget } from "./TutorWidget";
import { WidgetSettings } from "./WidgetSettings";

interface WidgetProps {
  widget: WidgetRow;
  rect: Rect;
  bounds: { w: number; h: number };
  active: boolean;
  /** Being moved or resized right now — lifts the widget off the board. */
  dragging: boolean;
  onFocus: () => void;
  onDrag: (rect: Rect) => void;
  onCommit: (rect: Rect) => void;
  onClose: () => void;
}

const RESIZE_HANDLES: Handle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function Widget({
  widget,
  rect,
  bounds,
  active,
  dragging,
  onFocus,
  onDrag,
  onCommit,
  onClose,
}: WidgetProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { snapshot } = useStore();
  const plugin =
    widget.kind === "custom"
      ? (snapshot?.installedWidgets.find((w) => w.manifest.id === widget.settings.pluginId) ?? null)
      : null;
  const title = widgetDisplayTitle(widget);
  const KindIcon = plugin ? widgetIcon(plugin.manifest.icon) : widgetKindMeta(widget.kind).icon;

  const rectRef = useRef(rect);
  rectRef.current = rect;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const begin = useCallback(
    (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onFocus();

      const target = event.currentTarget;
      const startRect: Rect = { ...rectRef.current };
      const originX = event.clientX;
      const originY = event.clientY;
      let latest = startRect;

      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        /* capture unsupported — listeners below still work */
      }

      const handleMove = (moveEvent: PointerEvent) => {
        latest = resolveRect(
          handle,
          startRect,
          moveEvent.clientX - originX,
          moveEvent.clientY - originY,
          boundsRef.current,
        );
        onDrag(latest);
      };

      const finish = () => {
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", finish);
        target.removeEventListener("pointercancel", finish);
        document.body.classList.remove("is-dragging");
        document.body.style.cursor = "";
        onCommit(latest);
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", finish);
      target.addEventListener("pointercancel", finish);
      document.body.classList.add("is-dragging");
      document.body.style.cursor = cursorFor(handle);
    },
    [onDrag, onCommit, onFocus],
  );

  return (
    <div
      className={`widget${active ? " widget--active" : ""}${dragging ? " widget--dragging" : ""}`}
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.w,
        height: rect.h,
        zIndex: dragging ? 20 : active ? 10 : 1,
      }}
      onPointerDown={onFocus}
    >
      <div className="widget__bar" onPointerDown={begin("drag")}>
        <span className="widget__title">
          <KindIcon size={14} aria-hidden />
          <span>{title}</span>
          {plugin && (
            <span onPointerDown={(e) => e.stopPropagation()}>
              <TrustBadge trust={plugin.trust} size={13} />
            </span>
          )}
        </span>
        <div className="widget__bar-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`widget__icon${settingsOpen ? " widget__icon--on" : ""}`}
            aria-label={`${title} settings`}
            title="Settings"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <Settings size={13} />
          </button>
          <button
            type="button"
            className="widget__icon widget__close"
            aria-label={`Remove ${title}`}
            title="Remove widget"
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="widget__body widget__body--flush">
        {widget.kind === "todo" && <TodoList widget={widget} />}
        {widget.kind === "blank" && <BlankWidget widget={widget} />}
        {widget.kind === "calendar" && (
          <CalendarWidget widget={widget} onOpenSettings={() => setSettingsOpen(true)} />
        )}
        {widget.kind === "transcribe" && <TranscribeWidget widget={widget} />}
        {widget.kind === "tutor" && <TutorWidget widget={widget} />}
        {widget.kind === "custom" && <CustomWidget widget={widget} />}

        {settingsOpen && (
          <WidgetSettings widget={widget} onClose={() => setSettingsOpen(false)} />
        )}
      </div>

      {RESIZE_HANDLES.map((handle) => (
        <span key={handle} className={`rz rz--${handle}`} onPointerDown={begin(handle)} />
      ))}
    </div>
  );
}
