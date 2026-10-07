import { useEffect, useState, type CSSProperties } from "react";

import {
  PAGE_COLOR_CYCLE,
  PAGE_COLOR_LABEL,
  PAGE_COLORS,
  pageColorHex,
  type PageColor,
} from "../../../shared/pageColors";
import type { PageRow } from "../../../shared/types";
import { DEFAULT_PAGE_ICON, PAGE_ICONS } from "../lib/pageIcons";
import "../styles/pages.css";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = creating a new page. */
  page: PageRow | null;
  widgetCount?: number;
  /** Colour a new page starts with (the next unused one). */
  suggestedColor: PageColor;
  onSave: (input: { title: string; icon: string; color: string }) => void;
  onDelete?: () => void;
}

/** Swatch order: the dealt cycle, then ink for anyone who wants the old look. */
const SWATCHES: PageColor[] = [...PAGE_COLOR_CYCLE, "ink"];

export function PageDialog({
  open,
  onOpenChange,
  page,
  widgetCount,
  suggestedColor,
  onSave,
  onDelete,
}: Props) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState(DEFAULT_PAGE_ICON);
  const [color, setColor] = useState<string>(suggestedColor);

  useEffect(() => {
    if (!open) return;
    setTitle(page?.title ?? "");
    setIcon(page?.icon ?? DEFAULT_PAGE_ICON);
    setColor(page?.color || suggestedColor);
  }, [open, page, suggestedColor]);

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave({ title: trimmed, icon, color });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        style={{ "--page": pageColorHex(color) } as CSSProperties}
      >
        <DialogHeader>
          <DialogTitle>{page ? "Edit page" : "New page"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="page-title">Name</Label>
            <Input
              id="page-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="page-color-label">Colour</Label>
            <div className="pg-swatches" role="radiogroup" aria-labelledby="page-color-label">
              {SWATCHES.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={color === key}
                  aria-label={PAGE_COLOR_LABEL[key]}
                  title={PAGE_COLOR_LABEL[key]}
                  className={`pg-swatch${color === key ? " is-active" : ""}`}
                  style={{ "--swatch": PAGE_COLORS[key] } as CSSProperties}
                  onClick={() => setColor(key)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Icon</Label>
            <div className="pg-icons">
              {Object.entries(PAGE_ICONS).map(([key, Icon]) => (
                <button
                  key={key}
                  type="button"
                  className={`pg-icons__opt${icon === key ? " is-active" : ""}`}
                  onClick={() => setIcon(key)}
                  aria-label={key}
                  aria-pressed={icon === key}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className={page && onDelete ? "sm:justify-between" : undefined}>
          {page && onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" className="text-destructive">
                  Delete page
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{page.title}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {widgetCount
                      ? `This also deletes its ${widgetCount} widget${widgetCount === 1 ? "" : "s"}. This can't be undone.`
                      : "This can't be undone."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      onDelete();
                      onOpenChange(false);
                    }}
                  >
                    Delete page
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={!title.trim()}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
