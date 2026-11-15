/**
 * Just enough markdown for release notes: headings, bullet lists, paragraphs,
 * **bold** and `code`. Builds React elements, never raw HTML.
 */
import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(
      t.startsWith("**") ? <strong key={k++}>{t.slice(2, -2)}</strong> : <code key={k++}>{t.slice(1, -1)}</code>,
    );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, skipFirstHeading = false }: { source: string; skipFirstHeading?: boolean }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  let k = 0;
  let headingSeen = false;
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={k++}>
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (para.length) {
      blocks.push(<p key={k++}>{inline(para.join(" "))}</p>);
      para = [];
    }
  };
  for (const raw of source.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (skipFirstHeading && !headingSeen) {
        headingSeen = true;
        continue;
      }
      blocks.push(<h3 key={k++}>{inline(h[2]!)}</h3>);
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (para.length) flush();
      list.push(li[1]!);
      continue;
    }
    if (list.length) flush();
    para.push(line);
  }
  flush();
  return <Fragment>{blocks}</Fragment>;
}
