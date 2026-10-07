import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

import { canonicalJson, type LicensePayload, type RegistryIndex, type SignedRegistry } from "@repo/widget-sdk";

/** PEMs are stored base64-encoded in env vars so newlines survive every UI. */
function pemFromEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  return raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
}

export function hasSigningKey(): boolean {
  return Boolean(pemFromEnv("MARKETPLACE_SIGNING_KEY"));
}

/** Signs the registry with the marketplace key the desktop app trusts. */
export function signRegistry(index: RegistryIndex): SignedRegistry {
  const pem = pemFromEnv("MARKETPLACE_SIGNING_KEY");
  if (!pem) throw new Error("MARKETPLACE_SIGNING_KEY is not configured");
  const key = createPrivateKey(pem);
  return {
    index,
    signature: sign(null, Buffer.from(canonicalJson(index)), key).toString("base64"),
    publicKey: createPublicKey(key).export({ type: "spki", format: "pem" }).toString(),
  };
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/* ---- publisher license keys, private half encrypted at rest ------------- */

function encryptionKey(): Buffer {
  const raw = process.env.LICENSE_ENCRYPTION_KEY;
  if (!raw) throw new Error("LICENSE_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("LICENSE_ENCRYPTION_KEY must be 32 bytes, base64");
  return key;
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function decrypt(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(body!), decipher.final()]).toString("utf8");
}

/** A fresh ed25519 pair per publisher: the public half goes in the registry,
 *  the private half signs license keys after a sale. */
export function newPublisherKeys(): { publicKey: string; sealedPrivateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    sealedPrivateKey: encrypt(privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
  };
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Same format `mypa-widget license` produces; the app verifies it offline. */
export function issueLicense(sealedPrivateKey: string, widgetId: string, licensee: string): string {
  const payload: LicensePayload = { widgetId, licensee, issuedAt: new Date().toISOString() };
  const json = JSON.stringify(payload);
  const sig = sign(null, Buffer.from(json), createPrivateKey(decrypt(sealedPrivateKey)));
  return `${b64url(Buffer.from(json))}.${b64url(sig)}`;
}
