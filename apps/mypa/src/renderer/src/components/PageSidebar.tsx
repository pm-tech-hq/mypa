import { useState, type CSSProperties } from "react";

import { Plus } from "lucide-react";

import { nextPageColor, pageColorHex } from "../../../shared/pageColors";
import type { PageRow } from "../../../shared/types";
import { pageIcon } from "../lib/pageIcons";
import { useReadyStore } from "../lib/store";
import "../styles/pages.css";
import { PageDialog } from "./PageDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function PageSidebar({ currentPageId }: { currentPageId: string }) {
  const { snapshot, actions } = useReadyStore();
  const [dialogPage, setDialogPage] = useState<PageRow | "new" | null>(null);
  const pages = snapshot.pages;

  const widgetCountFor = (pageId: string) =>
    snapshot.widgets.filter((w) => w.pageId === pageId).length;

  const editingPage = dialogPage === "new" ? null : dialogPage;

  return (
    <nav className="pg-sidebar">
      {pages.map((page) => {
        const Icon = pageIcon(page.icon);
        const active = page.id === currentPageId;
        return (
          <Tooltip key={page.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={`pg-sidebar__item${active ? " is-active" : ""}`}
                style={{ "--page": pageColorHex(page.color) } as CSSProperties}
                aria-label={active ? `${page.title} (edit page)` : page.title}
                aria-current={active ? "page" : undefined}
                onClick={() =>
                  active ? setDialogPage(page) : void actions.setCurrentPage(page.id)
                }
              >
                <Icon size={17} strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="pg-tip">
              <span>{page.title}</span>
              {active && <span className="pg-tip__hint">Click to edit</span>}
            </TooltipContent>
          </Tooltip>
        );
      })}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="pg-sidebar__item pg-sidebar__add"
            aria-label="Add page"
            onClick={() => setDialogPage("new")}
          >
            <Plus size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Add page</TooltipContent>
      </Tooltip>

      <PageDialog
        open={dialogPage !== null}
        onOpenChange={(open) => !open && setDialogPage(null)}
        page={editingPage}
        suggestedColor={nextPageColor(pages.map((p) => p.color))}
        widgetCount={editingPage ? widgetCountFor(editingPage.id) : undefined}
        onSave={(input) => {
          if (dialogPage === "new") {
            void actions.createPage(input);
          } else if (editingPage) {
            void actions.updatePage(editingPage.id, input);
          }
        }}
        onDelete={
          editingPage && pages.length > 1
            ? () => void actions.deletePage(editingPage.id)
            : undefined
        }
      />
    </nav>
  );
}
