import { createHash, createPublicKey, verify } from "node:crypto";

import {
  canonicalJson,
  type LicensePayload,
  type RegistryIndex,
  type SignedRegistry,
} from "../../shared/widgetPlatform";

/**
 * Keys myPA trusts to vouch for publishers. A registry signed by one of them
 * may mark publishers verified or official; any other registry's widgets are
 * community at best. Private halves live outside the repo:
 * - root: signs the catalog built into the app (`apps/mypa/.keys/`, offline)
 * - marketplace: signs the hosted registry at mypa-market.vercel.app (held
 *   as a Vercel env secret), so the root key never leaves this machine.
 */
export const ROOT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA1/H051Ur8fYC3GFnbXrN4wR5d7sR/rqRaf22zb7IES0=
-----END PUBLIC KEY-----`;

export const MARKETPLACE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEATkj5oy6JcHZ1nLQ1d0NGvYbTdCguwak8YOPmodN/RkI=
-----END PUBLIC KEY-----`;

const TRUSTED_KEYS = [ROOT_PUBLIC_KEY, MARKETPLACE_PUBLIC_KEY];

function sameKey(a: string, b: string): boolean {
  try {
    const ka = createPublicKey(a).export({ type: "spki", format: "der" });
    const kb = createPublicKey(b).export({ type: "spki", format: "der" });
    return ka.equals(kb);
  } catch {
    return false;
  }
}

function verifyWith(publicKeyPem: string, data: string, signatureB64: string): boolean {
  try {
    return verify(null, Buffer.from(data), createPublicKey(publicKeyPem), Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

export interface RegistryVerdict {
  /** Signature checks out against the key the registry names. */
  intact: boolean;
  /** ...and that key is the myPA root. */
  rootSigned: boolean;
}

export function verifyRegistry(signed: SignedRegistry): RegistryVerdict {
  const intact = verifyWith(signed.publicKey, canonicalJson(signed.index), signed.signature);
  return { intact, rootSigned: intact && TRUSTED_KEYS.some((k) => sameKey(signed.publicKey, k)) };
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Checks a license key against the publisher's key from a signed registry. */
export function verifyLicense(
  key: string,
  widgetId: string,
  publisherKeyPem: string | undefined,
): LicensePayload | null {
  if (!publisherKeyPem) return null;
  const [body, sig] = key.trim().split(".");
  if (!body || !sig) return null;
  try {
    const json = b64url(body).toString("utf8");
    if (!verify(null, Buffer.from(json), createPublicKey(publisherKeyPem), b64url(sig))) return null;
    const payload = JSON.parse(json) as LicensePayload;
    return payload.widgetId === widgetId ? payload : null;
  } catch {
    return null;
  }
}

export type { RegistryIndex };
