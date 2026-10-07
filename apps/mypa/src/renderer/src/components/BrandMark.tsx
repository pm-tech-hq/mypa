/** The myPA logo — a tile holding three "widgets", the board motif. */
export function BrandMark() {
  return (
    <svg
      className="brandmark"
      viewBox="0 0 256 256"
      width="18"
      height="18"
      aria-hidden
    >
      <rect x="18" y="18" width="220" height="220" rx="52" fill="var(--ds-fg)" />
      <rect x="52" y="58" width="58" height="140" rx="16" fill="var(--ds-surface)" />
      <rect x="126" y="58" width="78" height="62" rx="16" fill="var(--ds-surface)" />
      <rect x="126" y="136" width="78" height="62" rx="16" fill="var(--ds-surface)" />
    </svg>
  );
}
