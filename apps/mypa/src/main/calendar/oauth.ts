/**
 * Generic OAuth2 "loopback IP" flow for desktop apps: open the provider's
 * consent screen in the system browser, catch the redirect on a throwaway
 * local HTTP server, hand back the authorization code. Works the same way
 * for Google and Microsoft — provider-specific URLs/scopes live in their own
 * modules.
 */
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { shell } from "electron";

const TIMEOUT_MS = 180_000;

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export interface LoopbackResult {
  code: string;
  redirectUri: string;
}

const page = (message: string) =>
  `<!doctype html><html><body style="font:14px system-ui;padding:40px;text-align:center;color:#111">` +
  `<p>${message}</p></body></html>`;

/**
 * Starts a one-shot loopback server, opens `buildAuthUrl(redirectUri)` in the
 * system browser, and resolves with the authorization code once the provider
 * redirects back to it. Rejects on a provider error, a missing code, or a
 * three-minute timeout (the user never completed sign-in).
 */
export function runLoopbackAuth(
  buildAuthUrl: (redirectUri: string) => string,
): Promise<LoopbackResult> {
  return new Promise((resolve, reject) => {
    let redirectUri = "";
    let settled = false;

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Sign-in timed out")));
    }, TIMEOUT_MS);

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400).end();
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" }).end(page(`Sign-in failed: ${error}`));
        finish(() => reject(new Error(error)));
        return;
      }
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(page("Missing authorization code"));
        return;
      }

      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(page("Signed in — you can close this tab and go back to myPA."));
      finish(() => resolve({ code, redirectUri }));
    });

    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      settle();
    }

    server.on("error", (err) => finish(() => reject(err)));

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      void shell.openExternal(buildAuthUrl(redirectUri));
    });
  });
}
