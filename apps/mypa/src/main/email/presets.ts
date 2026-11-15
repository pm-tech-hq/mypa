import type { EmailAuth, EmailProvider, NewEmailAccount, ZohoRegion } from "../../shared/email";

export interface Servers {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

const ZOHO_DOMAIN: Record<ZohoRegion, string> = {
  com: "zoho.com",
  eu: "zoho.eu",
  in: "zoho.in",
  "com.au": "zoho.com.au",
  jp: "zoho.jp",
  ca: "zohocloud.ca",
  sa: "zoho.sa",
};

/** Where an account's mail lives. Throws when "Other" is missing a server. */
export function serversFor(input: NewEmailAccount): Servers {
  if (input.provider === "gmail") {
    return { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 };
  }
  if (input.provider === "zoho") {
    const domain = ZOHO_DOMAIN[input.zohoRegion ?? "com"] ?? "zoho.com";
    const pro = input.zohoOrg ? "pro" : "";
    return {
      imapHost: `imap${pro}.${domain}`,
      imapPort: 993,
      smtpHost: `smtp${pro}.${domain}`,
      smtpPort: 465,
    };
  }
  const imapHost = input.imapHost?.trim() ?? "";
  const smtpHost = input.smtpHost?.trim() ?? "";
  if (!imapHost || !smtpHost) throw new Error("Enter the IMAP and SMTP servers for this account.");
  return {
    imapHost,
    imapPort: input.imapPort || 993,
    smtpHost,
    smtpPort: input.smtpPort || 465,
  };
}

/** Advice for a login the server refused, by provider. */
export function authHelp(provider: EmailProvider, auth: EmailAuth = "password"): string {
  if (auth === "google")
    return "Gmail refused the Google sign-in. Sign in with Google again in the widget's settings, and allow myPA to read, send and manage your email.";
  if (provider === "gmail")
    return "Gmail refused the password. Use an app password (Google Account → Security → 2-Step Verification → App passwords), not your normal password.";
  if (provider === "zoho")
    return "Zoho refused the login. Use an app-specific password (Zoho Accounts → Security → App passwords), check that IMAP access is on in Zoho Mail settings, and that the region and account type are right.";
  return "The server refused the login. Check the address, password and server names.";
}
