# @repo/design-system

The shared visual language for every app in the monorepo.

- **Palette:** minimalist black (`#000`) and white (`#fff`) on a `#f2f2f2` ground.
- **Type:** Poppins (bundled via `@fontsource/poppins`, no network needed).

## Usage

Import the stylesheet once at the app root (e.g. `app/layout.tsx`, or the
Electron renderer entry):

```ts
import "@repo/design-system/styles.css";
```

This applies the base reset, the CSS custom properties (`--ds-*`), and the
Poppins font. Reference tokens in your own CSS:

```css
.card {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  box-shadow: var(--ds-shadow-1);
}
```

The same values are available to JS/TS:

```ts
import { color, font } from "@repo/design-system";
```
