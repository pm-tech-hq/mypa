import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { protocol } from "electron";

import poppins400 from "@fontsource/poppins/files/poppins-latin-400-normal.woff2?asset";
import poppins500 from "@fontsource/poppins/files/poppins-latin-500-normal.woff2?asset";
import poppins600 from "@fontsource/poppins/files/poppins-latin-600-normal.woff2?asset";

import { WIDGET_SCHEME } from "../../shared/widgetPlatform";
import sdkSource from "./runtime/sdk.js?raw";
import themeSource from "./runtime/theme.css?raw";
import { resolveWidgetFile } from "./store";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

/** Poppins inlined as data URIs: a widget's CSP only lets it load from its
 *  own origin, and this keeps the theme one self-contained response. */
function fontFaces(): string {
  return (
    [
      [400, poppins400],
      [500, poppins500],
      [600, poppins600],
    ] as const
  )
    .map(([weight, path]) => {
      try {
        const b64 = readFileSync(path).toString("base64");
        return `@font-face{font-family:"Poppins";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
      } catch {
        return "";
      }
    })
    .join("\n");
}

type RuntimeFile = { body: string; type: string };
let runtime: Record<string, RuntimeFile> | null = null;

function runtimeFiles(): Record<string, RuntimeFile> {
  runtime ??= {
    "__mypa/sdk.js": { body: sdkSource, type: MIME[".js"]! },
    "__mypa/theme.css": { body: `${fontFaces()}\n${themeSource}`, type: MIME[".css"]! },
  };
  return runtime;
}

/** Everything a widget may load comes from its own origin; it gets no
 *  network (that goes through the permission-checked bridge), no frames,
 *  no forms posting anywhere. */
function csp(id: string): string {
  const self = `${WIDGET_SCHEME}://${id}`;
  return [
    "default-src 'none'",
    `script-src ${self} 'unsafe-inline'`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `font-src ${self} data:`,
    `media-src ${self} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** Must run before `app.whenReady()`. */
export function registerWidgetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: WIDGET_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

export function handleWidgetProtocol(): void {
  protocol.handle(WIDGET_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = url.hostname;
    const path = url.pathname.replace(/^\/+/, "");
    const headers = (type: string) => ({
      "Content-Type": type,
      "Content-Security-Policy": csp(id),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });

    const builtin = runtimeFiles()[path];
    if (builtin) return new Response(builtin.body, { headers: headers(builtin.type) });

    const file = resolveWidgetFile(id, path);
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const data = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      return new Response(new Uint8Array(data), { headers: headers(type) });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
