/** Message structure and body helpers: finding the text part, decoding a
 *  partial body for snippets, and making HTML safe to show. */
import type { MessageStructureObject } from "imapflow";
import { JSDOM } from "jsdom";

export interface TextPart {
  part: string;
  encoding: string;
  charset: string;
  html: boolean;
}

const isAttachment = (n: MessageStructureObject): boolean =>
  n.disposition?.toLowerCase() === "attachment" ||
  (!n.type.startsWith("text/") &&
    !n.type.startsWith("multipart/") &&
    Boolean(n.dispositionParameters?.filename ?? n.parameters?.name));

/** The part to read a message from: plain text if there is one, else HTML. */
export function findTextPart(root: MessageStructureObject | undefined): TextPart | null {
  if (!root) return null;
  let plain: MessageStructureObject | null = null;
  let html: MessageStructureObject | null = null;
  const walk = (n: MessageStructureObject) => {
    if (n.childNodes?.length) {
      for (const c of n.childNodes) walk(c);
      return;
    }
    if (isAttachment(n)) return;
    if (n.type === "text/plain" && !plain) plain = n;
    else if (n.type === "text/html" && !html) html = n;
  };
  walk(root);
  const n = (plain ?? html) as MessageStructureObject | null;
  if (!n) return null;
  return {
    // a message that isn't multipart has no part number; its body is part 1
    part: n.part ?? "1",
    encoding: (n.encoding ?? "7bit").toLowerCase(),
    charset: (n.parameters?.charset ?? "utf-8").toLowerCase(),
    html: n === html,
  };
}

export function hasAttachments(root: MessageStructureObject | undefined): boolean {
  if (!root) return false;
  if (root.childNodes?.length) return root.childNodes.some(hasAttachments);
  return isAttachment(root);
}

/** Decodes the first bytes of a body part. The cut may fall mid-character or
 *  mid-escape, which is fine for a preview. */
export function decodePartial(raw: Buffer, encoding: string, charset: string): string {
  let bytes: Buffer;
  if (encoding === "base64") {
    const clean = raw.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, "");
    bytes = Buffer.from(clean.slice(0, clean.length - (clean.length % 4)), "base64");
  } else if (encoding === "quoted-printable") {
    const s = raw
      .toString("latin1")
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    bytes = Buffer.from(s, "latin1");
  } else {
    bytes = raw;
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  zwnj: "",
  "#8204": "",
  "#847": "",
};

/** Rough HTML to text, good enough for previews and AI input. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&([a-z]+|#\d+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k]!;
      if (k.startsWith("#")) return String.fromCodePoint(Number(k.slice(1)) || 32);
      return m;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

export function snippetOf(body: string, html: boolean): string {
  const text = html ? htmlToText(body) : body;
  return text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

const DROP = "script, iframe, frame, frameset, object, embed, applet, form, base, meta, link, noscript";

/**
 * Makes an email's HTML safe to show in a sandboxed frame: no scripts or
 * embeds, no event handlers, links open outside the app. Remote images are
 * removed (they tell the sender you opened the mail) unless `images` has
 * them already downloaded as data URIs.
 */
export function sanitizeHtml(
  html: string,
  images: Map<string, string> | null,
): { html: string; blocked: number; remote: string[] } {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  for (const el of doc.querySelectorAll(DROP)) el.remove();
  const remote = new Set<string>();
  let blocked = 0;
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src" || name === "action") && /^\s*(javascript|vbscript|data:text\/html)/i.test(value))
        el.removeAttribute(attr.name);
      else if (name === "srcset") el.removeAttribute(attr.name);
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noreferrer noopener");
    }
    if (el.tagName === "IMG" || el.tagName === "IMAGE") {
      const src = el.getAttribute("src") ?? "";
      if (/^https?:/i.test(src)) {
        remote.add(src);
        const local = images?.get(src);
        if (local) el.setAttribute("src", local);
        else {
          el.removeAttribute("src");
          blocked += 1;
        }
      }
    }
    const style = el.getAttribute("style");
    if (style && /url\(/i.test(style)) {
      el.setAttribute("style", style.replace(/url\([^)]*\)/gi, "none"));
    }
  }
  for (const s of doc.querySelectorAll("style")) {
    s.textContent = (s.textContent ?? "").replace(/@import[^;]*;/gi, "").replace(/url\([^)]*\)/gi, "none");
  }
  const out = doc.documentElement.outerHTML;
  dom.window.close();
  return { html: out, blocked, remote: [...remote] };
}
