import { BadgeCheck, ShieldAlert } from "lucide-react";

import type { TrustLevel } from "../../../shared/widgetPlatform";
import { TRUST } from "../lib/market";
import "../styles/market.css";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The marketplace's trust marks.
 * - official: a solid black seal (myPA's own ink)
 * - verified: a solid ultramarine seal
 * - community: nothing on the mark itself (label only where there's room)
 * - unverified: an amber shield, always labelled
 */
export function TrustBadge({
  trust,
  size = 14,
  withLabel = false,
}: {
  trust: TrustLevel;
  size?: number;
  withLabel?: boolean;
}) {
  if (trust === "community" && !withLabel) return null;
  const meta = TRUST[trust];
  const mark =
    trust === "official" || trust === "verified" ? (
      <BadgeCheck
        size={size}
        className={`trust-mark trust-mark--${trust}`}
        aria-hidden
        strokeWidth={2}
      />
    ) : trust === "unverified" ? (
      <ShieldAlert size={size} className="trust-mark trust-mark--unverified" aria-hidden />
    ) : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`trust trust--${trust}`} aria-label={meta.label} tabIndex={0}>
          {mark}
          {withLabel && <span className="trust__label">{meta.label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">{meta.detail}</TooltipContent>
    </Tooltip>
  );
}
