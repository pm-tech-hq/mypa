# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app, Windows first; the renderer is a web surface. Frameless window with custom title bar.)

## Users

A small team, starting with the founder/PM who runs several concurrent projects. The app is open all day on a desktop monitor and glanced at constantly between other work; it is a real command centre, not a demo.

## Product Purpose

myPA ("my personal assistant") is a board you fill with resizable widgets: To-do (tasks + goals by timeline), Calendar, Transcribe, Tutor, Blank. Multiple pages (boards), each with a chosen icon. Success is that the day's real work is visible, current, and actionable at a glance, without leaving the app.

## Positioning

Local-first and self-contained: data lives in a local SQLite file, transcription and tutoring run on-device, connected calendars are read-only and bring-your-own OAuth. Nothing requires an account or a cloud service.

## Operating Context

Long sessions on a desktop display under ordinary office/home light. Frequent, small interactions (checking steps, glancing at countdowns, switching pages) interleaved with occasional longer tasks (transcribing a video, a tutoring session, planning goals).

## Capabilities and Constraints

- Electron + electron-vite + React 19 + TS; shadcn/ui (Radix, Tailwind v4) mapped onto `--ds-*` tokens; lucide-react icons.
- SQLite via sql.js in the main process; every mutation returns a fresh snapshot over IPC.
- Widgets are dragged and resized freely on a canvas; widget contents must work from narrow (~320px) to wide.
- Everything must work fully offline with nothing connected.

## Brand Commitments

- Monochrome base: black `#000` ink, white `#fff`, ground `#f2f2f2`. This is the convention across every app in the monorepo (`@repo/design-system`).
- Colour: one **ultramarine accent** (`#234be9`) for interaction and "now" (actions, focus, selection, checked state, current tab, today, progress); **page colours** chosen per page, used for wayfinding only (sidebar tile, title-bar icon, board grid); the three **priority marks** (high/medium/low) keep meaning importance and stay small marks, never fills.
- Typeface: Poppins, bundled offline.
- Logo: the board-motif mark in `resources/icon.svg` / `BrandMark.tsx`.

## Evidence on Hand

A generic getting-started seed in `src/shared/seed.ts`. No customers, testimonials, or metrics to present, and none should be invented.

## Product Principles

1. Glanceable first: the state of the day reads in one look.
2. Quiet by default, loud only where it matters (priority, overdue).
3. Local and self-contained; no feature may depend on a cloud account.
4. Every widget behaves the same way: same chrome, same controls, same states.
