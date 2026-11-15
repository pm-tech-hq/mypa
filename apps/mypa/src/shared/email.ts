/** Email: accounts connected over IMAP (reading) and SMTP (sending) with an
 *  app password. Shared between the main process and the UI. Passwords never
 *  cross IPC; they stay encrypted in the main process. */

export type EmailProvider = "gmail" | "zoho" | "imap";
/** How myPA logs in: an (app) password, or a Google sign-in (Gmail only). */
export type EmailAuth = "password" | "google";
export type EmailAccountStatus = "connecting" | "connected" | "error";

/** Zoho runs a separate mail server per data centre. */
export const ZOHO_REGIONS = {
  com: "United States (zoho.com)",
  eu: "Europe (zoho.eu)",
  in: "India (zoho.in)",
  "com.au": "Australia (zoho.com.au)",
  jp: "Japan (zoho.jp)",
  ca: "Canada (zohocloud.ca)",
  sa: "Saudi Arabia (zoho.sa)",
} as const;
export type ZohoRegion = keyof typeof ZOHO_REGIONS;

export interface EmailAccount {
  id: string;
  provider: EmailProvider;
  auth: EmailAuth;
  /** Shown in the widget, e.g. "Work". Defaults to the address. */
  label: string;
  address: string;
  /** The name people see on mail you send. */
  displayName: string;
  status: EmailAccountStatus;
  errorMessage: string | null;
  lastSyncedAt: number | null;
  /** Unread messages in the inbox, as of the last sync. */
  unread: number;
  /** Desktop notification when new mail arrives. */
  notify: boolean;
  /** Added under what you write. */
  signature: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  sort: number;
}

export interface NewEmailAccount {
  provider: EmailProvider;
  address: string;
  password: string;
  label?: string;
  displayName?: string;
  /** Zoho only. */
  zohoRegion?: ZohoRegion;
  /** Zoho only: a custom-domain (organisation) mailbox uses imappro/smtppro. */
  zohoOrg?: boolean;
  /** Other (IMAP) only. Ports 993 and 465 use TLS from the start, others STARTTLS. */
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

/** Gmail through "Sign in with Google": the address comes from the account picked. */
export interface NewGoogleEmailAccount {
  label?: string;
  displayName?: string;
}

export type EmailAccountPatch = Partial<
  Pick<EmailAccount, "label" | "displayName" | "notify" | "signature">
> & {
  /** A new app password (the old one stops working when revoked). */
  password?: string;
};

/** The folders the widget can show. Each maps to the account's real mailbox. */
export type EmailFolder = "inbox" | "starred" | "sent" | "archive" | "trash" | "spam";
export const EMAIL_FOLDERS: { id: EmailFolder; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "starred", label: "Starred" },
  { id: "sent", label: "Sent" },
  { id: "archive", label: "Archive" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Trash" },
];

export interface EmailAddress {
  name: string;
  address: string;
}

/** A message as the list shows it. `id` is stable while it stays in its mailbox. */
export interface EmailSummary {
  id: string;
  accountId: string;
  folder: EmailFolder;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  /** The opening of the text, or null until it has been fetched. */
  snippet: string | null;
  date: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  /** Sorted by the AI (or the user) into a category, e.g. "Newsletters". Kept on this computer. */
  category: string | null;
  /** The Message-ID header, when the message has one. */
  messageId: string | null;
}

export interface EmailAttachment {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

/** A whole message, opened for reading. */
export interface EmailMessage extends EmailSummary {
  replyTo: EmailAddress[];
  references: string[];
  /** Plain text (always present; made from the HTML when there is none). */
  text: string;
  /** Sanitised HTML, or null for a plain-text message. Remote images are
   *  removed unless they were loaded with `loadImages`. */
  html: string | null;
  /** The HTML had remote images that weren't loaded. */
  blockedImages: number;
  attachments: EmailAttachment[];
}

export interface EmailListQuery {
  /** null = every account. */
  accountIds: string[] | null;
  folder: EmailFolder;
  /** Searches the server (subject, people and text). */
  search?: string;
  unreadOnly?: boolean;
  /** Only mail from this sender (part of a name or address). */
  from?: string;
  /** Received on or after this time (ms). */
  since?: number;
  /** Received before this time (ms). */
  before?: number;
  /** Only mail sorted into this category. */
  category?: string;
  limit?: number;
}

export interface EmailListResult {
  messages: EmailSummary[];
  /** Accounts that couldn't be reached for this list. */
  errors: { accountId: string; message: string }[];
  /** How many messages matched in all, when more matched than were returned. */
  total: number;
}

/** The categories "Sort" uses unless the user has made their own. */
export const DEFAULT_CATEGORIES = [
  "Important",
  "Work",
  "Personal",
  "Updates",
  "Receipts",
  "Newsletters",
  "Promotions",
  "Social",
] as const;

export interface EmailCategoryPatch {
  id: string;
  /** null removes the category. */
  category: string | null;
}

export type EmailAction = "read" | "unread" | "star" | "unstar" | "archive" | "trash" | "inbox";

export interface EmailActionResult {
  /** Pass to `undo` to reverse a move (archive, trash, back to inbox). */
  undoToken: string | null;
}

export interface PickedFile {
  /** Opaque handle for `send`; only files picked in the dialog can be attached. */
  token: string;
  name: string;
  size: number;
}

export interface SendEmailInput {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  files?: string[];
  /** Replying: threads the message and marks the original answered. */
  replyToId?: string;
  /** Forwarding: the original's attachments go along unless `dropAttachments`. */
  forwardOfId?: string;
  dropAttachments?: boolean;
}

/** A draft written for you (by the Assistant) to review, edit and send yourself. */
export interface EmailDraft {
  id: string;
  accountId: string | null;
  to: string;
  cc: string;
  subject: string;
  text: string;
  replyToId: string | null;
  /** Why it was written, shown with the draft. */
  note: string;
  createdAt: number;
}

export type EmailEvent =
  | { type: "accounts"; accounts: EmailAccount[] }
  /** Mail in an account changed (new, flags, moved); lists should refresh. */
  | { type: "mail"; accountId: string }
  | { type: "drafts"; drafts: EmailDraft[] };

export const EMAIL_IPC = {
  accounts: "email:accounts",
  addAccount: "email:addAccount",
  addGoogle: "email:addGoogle",
  reconnectGoogle: "email:reconnectGoogle",
  updateAccount: "email:updateAccount",
  removeAccount: "email:removeAccount",
  syncAccount: "email:syncAccount",
  list: "email:list",
  open: "email:open",
  loadImages: "email:loadImages",
  act: "email:act",
  undo: "email:undo",
  pickFiles: "email:pickFiles",
  saveAttachment: "email:saveAttachment",
  send: "email:send",
  drafts: "email:drafts",
  dismissDraft: "email:dismissDraft",
  setCategories: "email:setCategories",
  event: "email:event",
} as const;

export interface MypaEmail {
  accounts: () => Promise<EmailAccount[]>;
  /** Connects and checks the account; resolves with its row (status says how it went). */
  addAccount: (input: NewEmailAccount) => Promise<EmailAccount>;
  /**
   * Opens Google's sign-in in the browser and connects the Gmail account picked
   * there (or switches an already-connected one to Google sign-in).
   */
  addGoogle: (input: NewGoogleEmailAccount) => Promise<EmailAccount>;
  /** Signs this Gmail account in with Google again (also switches it off an app password). */
  reconnectGoogle: (id: string) => Promise<EmailAccount[]>;
  updateAccount: (id: string, patch: EmailAccountPatch) => Promise<EmailAccount[]>;
  removeAccount: (id: string) => Promise<EmailAccount[]>;
  syncAccount: (id: string) => Promise<EmailAccount[]>;
  list: (query: EmailListQuery) => Promise<EmailListResult>;
  open: (id: string) => Promise<EmailMessage>;
  loadImages: (id: string) => Promise<EmailMessage>;
  /** Ids may come from different accounts and folders. */
  act: (ids: string[], action: EmailAction) => Promise<EmailActionResult>;
  undo: (token: string) => Promise<void>;
  pickFiles: () => Promise<PickedFile[]>;
  /** Asks where to save; false when cancelled. */
  saveAttachment: (id: string, index: number) => Promise<boolean>;
  send: (input: SendEmailInput) => Promise<void>;
  drafts: () => Promise<EmailDraft[]>;
  dismissDraft: (id: string) => Promise<EmailDraft[]>;
  setCategories: (patches: EmailCategoryPatch[]) => Promise<void>;
  onEvent: (cb: (e: EmailEvent) => void) => () => void;
}
