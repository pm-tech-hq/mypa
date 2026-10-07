/** "Other calendars" sibling for pages: fetch a URL, extract the readable
 *  article text (Firefox Reader View's own algorithm), strip everything else. */
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ExtractedPage {
  title: string;
  text: string;
}

export async function extractPageText(url: string): Promise<ExtractedPage> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; myPA/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Couldn't fetch that page (${res.status} ${res.statusText}).`);
  }
  const html = await res.text();

  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (!article?.textContent?.trim()) {
    throw new Error("Couldn't find readable article content on that page.");
  }

  const text = article.textContent
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title: article.title || url, text };
}
