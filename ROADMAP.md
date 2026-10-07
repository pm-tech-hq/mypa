# Roadmap

This is where myPA is headed and, just as important, where it isn't. It's a living document: items move as we learn. If you want to work on something here, comment on its issue (or open one) first.

## The direction

**myPA is the one window you keep open all day to run your work.** It should feel like a calm, trustworthy desk, not another busy app. Three ideas guide every decision:

1. **Your desk, your data.** Everything works offline and lives in a file you own. Cloud features are optional add-ons you connect deliberately, never requirements.
2. **Glance, then act.** The board shows what matters now. Common actions take one click and happen in place, without dialogs or app switching.
3. **A small core, an open edge.** The core app stays focused: tasks, calendar, notes, learning. Everything else grows through sandboxed widgets anyone can build, share or sell.

## Now

These are the current focus. Contributions here are the most useful.

- **Automated tests.** Add Vitest for pure logic (date helpers, markdown, registry trust, migrations) and Playwright `_electron` smoke tests for the main flows: add/edit/delete a task, add an event, install a widget. Run them in CI.
- **Continuous integration.** A GitHub Actions workflow that runs `check-types`, `lint`, `build` and the tests on every pull request.
- **User-defined projects.** Projects are free-form text today, with a few suggested names. Add a proper way to create, rename, colour and archive projects.
- **Release pipeline.** A signed Windows installer, version numbers that follow releases, and auto-update.
- **Remove template leftovers.** `apps/docs`, `apps/web` and `packages/ui` come from the Turborepo starter. Either repurpose them (a documentation site is a good candidate) or remove them.
- **End-to-end marketplace purchase test.** Run a full paid-widget flow in Stripe test mode: price, checkout, webhook, license key, activation in the app.

## Next

These are planned and designed in principle, waiting for someone to pick them up.

- **macOS and Linux builds.** Packaging per platform, and pruning the native binaries bundled for other platforms to cut the installer size.
- **Board layout helpers.** Snap-to-grid and alignment guides while dragging, plus keyboard moves for widgets.
- **Calendar depth.** Multi-day and recurring events for local entries, and better handling of all-day events that span days.
- **To-do depth.**
  - Recurring tasks.
  - Reordering backlog groups.
  - Quick-add syntax (for example "tomorrow" or "!high") with a visible hint.
- **Tutor depth.**
  - Spaced-repetition review of past quiz questions.
  - Turning an answer into a goal with suggested tasks.
  - Searching past chats.
- **Licence key delivery by email** after a marketplace purchase (today the key is shown on the success page only).
- **Publish the widget SDK** (`@repo/widget-sdk` and the `mypa-widget` CLI) to npm, so creators don't need this repository.
- **Accessibility audit** of every widget: screen-reader names, focus order, contrast at every state.
- **Import and export.** Full data export (JSON) and import, beyond the per-transcript export that exists today.

## Later

These are ideas we like. They need design work before code.

- **Optional encrypted sync** between your own devices, end-to-end encrypted and off by default. The local file stays the source of truth.
- **Dark theme**, designed properly rather than inverted, with the same one-accent rule.
- **More SDK capabilities**, each permission-gated and narrow: reading notes, adding calendar events (local only), and a scheduled background refresh for widgets.
- **A project dashboard widget** that rolls up a project's goals, tasks and upcoming events.
- **Localisation.** Translatable strings and locale-aware formats throughout.

## Not planned

These are deliberately out of scope, so please discuss before proposing them.

- **Accounts or a required cloud backend** for the desktop app. myPA must stay fully usable offline, with no sign-in.
- **Writing to connected calendars.** Connected calendars are read-only by design; your own events live locally.
- **Telemetry or analytics** in the desktop app.
- **Running widget code outside the sandbox**, or giving widgets direct filesystem or network access.
- **Becoming a team collaboration tool** (shared boards, comments, assignments). myPA is a personal tool; integrations with team tools via widgets are fine.

## Recently done

Kept short; the commit history has the details.

- Core widgets polished: in-place editing, undo everywhere, drag between lists, event details, transcript search and export, sticky Tutor scroll, markdown notes with checklists.
- Official marketplace widgets 1.0.1: long breaks, habit history, city-name clocks, hourly weather, an in-widget countdown editor, editable quick links, and ticking tasks off from Today's focus.
- Crash-safe database saves with automatic recovery from a backup.
- The widget host no longer re-sends unchanged settings, which caused refetch loops.
- The hosted marketplace is live, with signed registries, publisher uploads and Stripe Connect.
