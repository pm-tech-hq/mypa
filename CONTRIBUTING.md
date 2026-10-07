# Contributing to myPA

Thanks for helping. myPA is small and opinionated, so this guide is mostly about keeping it that way: a calm, local-first tool that people trust with their day.

If anything here is unclear, open an issue and ask. That's a contribution too.

## Ways to help

- **Report a bug.** Include what you did, what you expected and what happened, plus your OS and myPA version. A screenshot or short screen recording helps a lot.
- **Suggest an idea.** Open an issue describing the problem you want solved, not just the feature. Check [ROADMAP.md](ROADMAP.md) first, in case it's already planned or deliberately out of scope.
- **Build a widget.** Most new functionality belongs in a widget, not in the core app. See [`packages/widget-sdk/README.md`](packages/widget-sdk/README.md).
- **Fix or improve the app.** Pick an issue labelled `good first issue` or `help wanted`, or one from the roadmap's **Now** list.

## Before you write code

1. **Open or find an issue first** for anything bigger than a small fix. Agree on the approach before you spend a weekend on it. Pull requests that arrive out of nowhere with large design or behaviour changes are hard to accept.
2. **One change per pull request.** A bug fix, a widget, a refactor: separately.
3. **Check the direction.** If your idea is listed under **Not planned** in the roadmap, start a discussion rather than a pull request.

## Development setup

```sh
pnpm install
pnpm --filter mypa dev          # desktop app, hot reload
pnpm --filter market dev        # marketplace site (needs apps/market/.env.local)
```

Requirements: Node.js 24+, pnpm 11. Windows is the primary platform today.

**Never develop against your real data.** Point the app at a throwaway profile:

```sh
pnpm --filter mypa build
cd apps/mypa && npx electron . --user-data-dir=../../.scratch/profile
```

To reproduce a bug from your own data, copy `%APPDATA%/mypa/mypa.db` into that profile folder. Never attach someone's database to an issue.

## The rules

### Product rules

These come from [`apps/mypa/PRODUCT.md`](apps/mypa/PRODUCT.md). Changes that break them won't be merged.

- **Local first.** No feature may require an account or a cloud service. Network features must be optional, clearly explained, and work only with what the user chose to connect.
- **The user's data is sacred.**
  - Never lose it: destructive actions get Undo, or a confirmation when undo is impossible.
  - Never change it silently.
  - Never send it anywhere the user didn't ask for.
- **Glanceable and quiet.** Prefer showing state over adding controls. Colour has meaning; don't use it as decoration.
- **Every widget behaves the same way.** Use the shared widget chrome, controls, empty, loading and error states. Don't invent a one-off pattern when one exists.

### Design rules

- Use the tokens in `packages/design-system` (`--ds-*`). Don't hard-code colours, radii or durations.
- The palette is black, white and `#f2f2f2`, plus **one** ultramarine accent for interaction and "now": primary actions, focus, selection, checked state, today, progress. Page colours are for wayfinding only. Priority squares mean importance and stay small marks, never fills.
- The typeface is Poppins, bundled. Don't add fonts.
- Icons come from `lucide-react` in the app. In sandboxed widgets, use small inline SVGs. Never use emoji or unicode glyphs as icons.
- Every interactive element needs default, hover, focus-visible, active and disabled states. Keyboard users must be able to reach and operate everything.
- Widgets get resized freely. Check your change at a **narrow** (about 320px) and a **wide** size.
- Motion is short and purposeful, and `prefers-reduced-motion` is respected.
- Copy is plain and specific. Buttons name their action. Errors say what went wrong and what to do next.

### Code rules

- **TypeScript, strict.** No `any` without a comment explaining why.
- **Match the surrounding code:** naming, comment density, structure. Comments explain *why*, not *what*.
- **Formatting:** run Prettier with `--print-width 100` on the files you touch. Don't reformat files you didn't change.
- **Keep the main process the single owner of data.** The renderer never touches the database directly; it calls `window.mypa.*` and renders the snapshot it gets back.
- **The preload bridge stays narrow.** Every new IPC call needs input validation in the main process. Never expose Node, the filesystem or secrets to the renderer.
- **Schema changes go through `migrate()`** in `apps/mypa/src/main/db.ts`, and must upgrade an existing database without data loss. Test against a copy of a real, older database, not only a fresh one.
- **Heavy work goes off the UI thread.** Anything slow (models, ffmpeg, large parsing) belongs in a worker or the main process, never in a render path.
- **Dependencies:** think twice. Every native dependency complicates packaging. Say why in the pull request.

### Widget platform rules

- Widgets are untrusted code. New SDK capabilities must be permission-gated, validated in the host, and as narrow as possible. `tasks.setDone` is a good example: it can tick a task off, not edit it.
- A new permission or bridge method needs updates in all of these places:
  - `packages/widget-sdk/src/platform.ts` (the type and its user-facing description)
  - the runtime `apps/mypa/src/main/widgets/runtime/sdk.js`
  - the host handler in `CustomWidget.tsx`
  - the SDK README
- Changing an official widget means bumping its `version` in `manifest.json`. Signing the built-in catalog (`pnpm --filter mypa widgets:build`) needs a maintainer's private key and is done by maintainers. Contributors test with **Load unpacked folder**.
- Widgets must not hammer third-party services:
  - cache responses
  - never cache error replies
  - back off on failure
  - don't refetch from `onSettings` unless the relevant settings actually changed

### Security and privacy rules

- **Never commit secrets:** no keys, tokens, `.env` files, signing keys (`.keys/`) or databases. `.gitignore` covers the usual paths. Check your diff anyway.
- **Never commit personal data:** none in code, seed data, tests, fixtures or screenshots. Screenshots must come from a clean demo profile.
- **Report vulnerabilities privately**, using GitHub's *Report a vulnerability* (Security tab). Don't open a public issue for a security problem.

## Checks before you open a pull request

```sh
pnpm check-types
pnpm lint
pnpm build
```

All three must pass with zero warnings. Then **run the app** and walk through your change, including:

- the empty state, a long title, and a narrow widget
- keyboard only
- what happens on error (go offline, use a wrong key)
- for data changes: an existing database, not just a fresh one

There's no automated test suite yet. If your change is logic-heavy, adding tests is very welcome; see the roadmap.

## Commits and pull requests

- Write commit messages that say **what changed and why**, in plain English, for example "Calendar: keep the end time when the start moves". Keep them small and focused.
- In the pull request description, include:
  - what problem it solves, linking the issue
  - how you tested it
  - **before/after screenshots** for any UI change
  - anything you weren't able to test
- Keep pull requests reviewable: one concern each, a few hundred lines at most where possible.
- Expect review comments about the rules above. They're how the app stays coherent, not a judgement of your work.

## Code of conduct

Be kind, be specific, assume good intent. Critique code and ideas, not people. Harassment, discrimination and personal attacks aren't tolerated anywhere in the project: issues, pull requests, discussions. Maintainers may remove content or block people who don't follow this.

## Licensing

By opening a pull request, you agree that your contribution is licensed under the license of the part of the repository it changes. This is the usual "inbound = outbound" rule, and there's no separate agreement to sign.

- **Most of the repository** (the desktop app, the marketplace site, the design system and the official widgets): [GNU AGPL-3.0](LICENSE).
- **The widget SDK and CLI** (`packages/widget-sdk`): [MIT](packages/widget-sdk/LICENSE).

Only contribute code you wrote yourself, or code whose license is compatible with these. If you're copying from another project, say so in the pull request and keep its copyright notice.
