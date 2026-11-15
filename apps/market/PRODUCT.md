# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People with busy, mixed days: work, study and home in one life. They keep one window open all day and want to see what matters now without hopping between a to-do app, a calendar, a mail client and a notes app. Mostly Windows desktop users today. Secondary audiences on this site: widget developers (build, publish, sell) and existing myPA users looking for widgets, updates and help.

## Product Purpose

my-pa.xyz is the home of myPA, a free, open-source desktop personal assistant: a board of widgets (tasks, calendar, email, planner, notes, learning, money, journal) with an AI Assistant that can work across them. The site must explain what myPA is, get people to download it, answer the questions they have before and after installing, and host the widget Marketplace and its developer pages. Success: a visitor understands the board in one screen and downloads the installer; a developer finds how to build and sell a widget.

## Positioning

Local first. The board, its data and the built-in AI model run on the user's own computer; the data is one file they own. Cloud accounts (calendar, email, an AI provider) are optional and connected deliberately. Marketplace widgets are sandboxed and signed, so a trust mark is decided by signatures, not by claims.

## Operating Context

- Desktop app (Electron), Windows 10/11 first. macOS and Linux build but are untested.
- Installer from GitHub Releases (pm-tech-hq/mypa). Auto-updates from the same feed. Installers are not code-signed yet: Windows SmartScreen shows a warning, and Smart App Control can block installs and updates.
- Marketplace: Next.js on Vercel at my-pa.xyz, signed `/registry.json` read by the app, GitHub sign-in for publishers, Stripe Connect for paid widgets.

## Capabilities and Constraints

- Built-in widgets (22): To-do, Calendar, Transcribe, Tutor, Typing, Flashcards, Email, Meetings, Project Tracker, Personal Memory, Unit Converter, Timer & Stopwatch, Calculator, Daily Briefing, Study Planner, Journal, Shopping Lists, Quick Capture, Daily Planner, Reminders, Expenses, Note. Plus Marketplace widgets.
- Assistant: built-in offline model or the user's own AI account (OpenAI-compatible or Anthropic); asks before acting on mail or calendars; undo.
- Calendar: Google, Zoho, iCloud, Fastmail, CalDAV, read-only Outlook/ICS. Email: Gmail, Zoho, any IMAP.
- Transcription with Whisper on-device. Journal locked with a passcode, reset with Windows Hello.
- Price: free. License AGPL-3.0 (app, site), MIT (widget SDK).
- Current version 0.2.2. Changelog: GitHub Releases.

## Brand Commitments

- Name written "myPA". Logo: `components/BrandMark.tsx`.
- Shares the app's design system (`@repo/design-system`): monochrome ground, black ink, one ultramarine accent (#234be9), Poppins. The user chose to evolve this look for the site, not replace it.
- Voice: plain, calm, specific. Says what happens to your data.

## Evidence on Hand

- Real product UI only: the app itself (rebuilt as live HTML on the site) and `docs/screenshots/` (demo boards).
- No testimonials, user counts, press or reviews exist. Do not invent any.
- No company address, phone or team page facts. Contact is GitHub (issues).

## Product Principles

1. Your desk, your data: everything works offline; cloud is opt-in.
2. Glance, then act: the day reads in one look.
3. Quiet by default: loud only for what matters.
4. Small core, open edge: everything else grows through sandboxed widgets.
5. Honest about rough edges (unsigned installer, Windows first).

## Accessibility & Inclusion

WCAG AA contrast, keyboard reachable, reduced motion respected.
