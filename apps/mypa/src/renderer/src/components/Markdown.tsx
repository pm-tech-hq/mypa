import { Fragment, type ReactNode } from "react";

/* A small, dependency-free markdown renderer for tutor answers and notes:
 * headings, paragraphs, bullet / numbered / task lists, fenced code, rules,
 * **bold**, *italic*, `code` and https links (opened in the browser). */

const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|(?<!\w)_[^_\s][^_]*_(?!\w))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={i}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link)
      return (
        <a
          key={i}
          href={link[2]}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void window.mypa.market.openExternal(link[2]!);
          }}
        >
          {link[1]}
        </a>
      );
    if (
      part.length > 2 &&
      ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_")))
    )
      return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

interface Item {
  text: string;
  /** Source line, so a task checkbox can be toggled in the original text. */
  line: number;
  task: boolean | null;
}

const TASK = /^\[( |x|X)\]\s+(.*)$/;

export function Markdown({
  text,
  className,
  onToggleTask,
}: {
  text: string;
  className?: string;
  /** Called with the source line index when a `- [ ]` checkbox is clicked. */
  onToggleTask?: (line: number) => void;
}) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: Item[] } | null = null;
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const tasks = list.items.every((it) => it.task !== null);
    blocks.push(
      <Tag key={blocks.length} className={tasks ? "md-tasks" : undefined}>
        {list.items.map((it) =>
          it.task === null ? (
            <li key={it.line}>{inline(it.text)}</li>
          ) : (
            <li key={it.line} className={`md-task${it.task ? " is-done" : ""}`}>
              <button
                type="button"
                className={`row__check row__check--sm${it.task ? " row__check--on" : ""}`}
                aria-label={it.task ? `Mark “${it.text}” not done` : `Mark “${it.text}” done`}
                aria-pressed={it.task}
                disabled={!onToggleTask}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTask?.(it.line);
                }}
              />
              <span>{inline(it.text)}</span>
            </li>
          ),
        )}
      </Tag>,
    );
    list = null;
  };

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      if (code) {
        blocks.push(
          <pre key={blocks.length}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else {
        flushPara();
        flushList();
        code = [];
      }
      return;
    }
    if (code) {
      code.push(raw);
      return;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1]!.length;
      const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      blocks.push(<Tag key={blocks.length}>{inline(heading[2]!)}</Tag>);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      flushList();
      blocks.push(<hr key={blocks.length} />);
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      const body = (bullet ?? numbered)![1]!;
      const task = !ordered ? TASK.exec(body) : null;
      list.items.push(
        task
          ? { text: task[2]!, line: index, task: task[1] !== " " }
          : { text: body, line: index, task: null },
      );
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  });
  // An unfinished code fence (still streaming) shows what has arrived so far.
  if (code)
    blocks.push(
      <pre key={blocks.length}>
        <code>{(code as string[]).join("\n")}</code>
      </pre>,
    );
  flushPara();
  flushList();
  return <div className={`md${className ? ` ${className}` : ""}`}>{blocks}</div>;
}

/** Flips `- [ ]` ↔ `- [x]` on one line of the source. */
export function toggleTaskLine(text: string, line: number): string {
  const lines = text.split("\n");
  const cur = lines[line];
  if (cur === undefined) return text;
  lines[line] = cur.replace(/\[( |x|X)\]/, (m) => (m === "[ ]" ? "[x]" : "[ ]"));
  return lines.join("\n");
}
