declare module "*?asset" {
  const src: string;
  export default src;
}

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*?inline" {
  const dataUrl: string;
  export default dataUrl;
}

interface ImportMetaEnv {
  /** A Google "Desktop app" OAuth client built into this copy (apps/mypa/.env.local, never committed). */
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob<T = unknown>(
    pattern: string,
    options: { query?: string; import?: string; eager: true },
  ): Record<string, T>;
}
