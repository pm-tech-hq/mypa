/**
 * Encrypts calendar secrets (OAuth client secrets, refresh/access tokens, ICS
 * feed URLs — the latter often embed a private token) at rest via Electron's
 * `safeStorage`, which is backed by the OS keychain / DPAPI / libsecret.
 *
 * `safeStorage` can be unavailable (e.g. a Linux box with no keyring daemon).
 * Rather than crash, we fall back to storing the value with a `plain:` marker
 * so the app still works — degraded, not broken. `isEncryptionAvailable()` is
 * the common case and is what real installs get.
 */
import { safeStorage } from "electron";

const PLAIN_PREFIX = "plain:";

export function encryptSecret(plain: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain);
  }
  return Buffer.concat([Buffer.from(PLAIN_PREFIX, "utf8"), Buffer.from(plain, "utf8")]);
}

export function decryptSecret(data: Uint8Array | null | undefined): string | null {
  if (!data || data.length === 0) return null;
  const buf = Buffer.from(data);
  const prefix = buf.subarray(0, PLAIN_PREFIX.length).toString("utf8");
  if (prefix === PLAIN_PREFIX) {
    return buf.subarray(PLAIN_PREFIX.length).toString("utf8");
  }
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}
