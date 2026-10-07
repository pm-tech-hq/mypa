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

interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options: { query?: string; import?: string; eager: true },
  ): Record<string, T>;
}
