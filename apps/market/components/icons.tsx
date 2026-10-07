import {
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  Calculator,
  CalendarDays,
  Clock,
  CloudSun,
  Globe,
  Heart,
  Hourglass,
  Link2,
  ListChecks,
  ListPlus,
  Music,
  Puzzle,
  Quote,
  Repeat,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { describePermission, type Permission, type TrustLevel } from "@repo/widget-sdk";

const ICONS: Record<string, LucideIcon> = {
  timer: Timer,
  repeat: Repeat,
  link: Link2,
  hourglass: Hourglass,
  globe: Globe,
  "cloud-sun": CloudSun,
  target: Target,
  quote: Quote,
  calculator: Calculator,
  music: Music,
  "book-open": BookOpen,
  "bar-chart": BarChart3,
  heart: Heart,
  zap: Zap,
  puzzle: Puzzle,
  sparkles: Sparkles,
  clock: Clock,
  "list-checks": ListChecks,
};

export function WidgetIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Puzzle;
  return <Icon size={size} aria-hidden />;
}

export function Tile({ icon, size = "md" }: { icon: string; size?: "md" | "lg" | "xl" }) {
  const px = size === "xl" ? 40 : size === "lg" ? 26 : 21;
  return (
    <span className={`tile${size === "md" ? "" : ` tile--${size}`}`}>
      <WidgetIcon name={icon} size={px} />
    </span>
  );
}

const TRUST_COPY: Record<TrustLevel, { label: string; detail: string }> = {
  official: { label: "Official", detail: "Made by myPA" },
  verified: { label: "Verified publisher", detail: "Identity checked by myPA" },
  community: { label: "Community", detail: "Identity not checked" },
  unverified: { label: "Unverified", detail: "Unknown source" },
};

/** The same marks the desktop app shows: a black seal for myPA itself, an
 *  ultramarine seal for verified publishers, nothing for community. */
export function Seal({ trust, size = 15 }: { trust: TrustLevel; size?: number }) {
  if (trust !== "official" && trust !== "verified") return null;
  const copy = TRUST_COPY[trust];
  return (
    <BadgeCheck size={size} className={`seal seal--${trust}`} aria-label={copy.label} role="img">
      <title>{`${copy.label}: ${copy.detail}`}</title>
    </BadgeCheck>
  );
}

export function TrustLabel({ trust }: { trust: TrustLevel }) {
  return (
    <span className={`trust-label trust-label--${trust}`}>
      <Seal trust={trust} size={16} />
      {TRUST_COPY[trust].label}
    </span>
  );
}

const PERMISSION_ICON: Record<string, LucideIcon> = {
  "tasks:read": ListChecks,
  "tasks:write": ListPlus,
  "calendar:read": CalendarDays,
  notify: Bell,
};

export function PermissionList({ permissions }: { permissions: Permission[] }) {
  if (!permissions.length)
    return (
      <ul className="perms">
        <li>
          <ShieldCheck size={16} aria-hidden />
          Needs no access to your data or the internet.
        </li>
      </ul>
    );
  return (
    <ul className="perms">
      {permissions.map((p) => {
        const Icon = PERMISSION_ICON[p] ?? Globe;
        return (
          <li key={p}>
            <Icon size={16} aria-hidden />
            {describePermission(p)}
          </li>
        );
      })}
    </ul>
  );
}
