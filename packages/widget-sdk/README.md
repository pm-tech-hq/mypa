# @repo/widget-sdk

Build custom widgets for myPA. Share them as files, or publish them to a signed registry that appears in the in-app **Marketplace**. You can also sell them.

## What a widget is

A widget is a folder of plain web files:

```
my-widget/
  manifest.json   what it is, what it needs
  index.html      the entry point
  widget.js       anything else you like: CSS, images, fonts, a bundled framework build
```

myPA runs each widget in a **sandboxed iframe**. The iframe has its own origin and a strict CSP, and:

- it has no direct network access;
- it has no cookies or `localStorage`;
- it cannot reach the app.

Everything goes through the `mypa` object, and myPA checks every call against the permissions the user approved at install.

## Quick start

```sh
node packages/widget-sdk/bin/mypa-widget.ts init my-widget --id you.my-widget --name "My widget"
```

In myPA, open **Add widget → Browse the marketplace → Developer → Load unpacked folder** and pick `my-widget/`. The widget reloads every time you save. Add it to a page from the Add widget menu.

## The manifest

```json
{
  "schema": 1,
  "id": "you.my-widget",
  "name": "My widget",
  "version": "1.0.0",
  "summary": "One line for cards and menus (90 chars max).",
  "description": "Longer text for the detail page.\n\nBlank lines make paragraphs.",
  "publisher": { "id": "you", "name": "Your name" },
  "icon": "sparkles",
  "category": "productivity",
  "entry": "index.html",
  "size": { "w": 360, "h": 280, "minW": 240, "minH": 160 },
  "permissions": ["tasks:read", "net:api.example.com"],
  "settings": [
    { "key": "city", "label": "City", "type": "text", "default": "London" },
    { "key": "count", "label": "How many", "type": "number", "default": 3, "min": 1, "max": 10 },
    { "key": "compact", "label": "Compact", "type": "toggle", "default": false },
    { "key": "units", "label": "Units", "type": "select", "default": "c",
      "options": [{ "value": "c", "label": "Celsius" }, { "value": "f", "label": "Fahrenheit" }] }
  ],
  "price": { "amount": 499, "currency": "USD", "checkoutUrl": "https://buy.stripe.com/..." },
  "homepage": "https://example.com"
}
```

Field notes:

- **id**: must start with your publisher id.
- **icon**: one of `timer repeat link hourglass globe cloud-sun target quote calculator music book-open bar-chart heart zap puzzle sparkles clock list-checks`.
- **category**: one of `productivity focus planning tracking information fun`.
- **settings**: myPA builds the settings form from these fields for you. Each widget on a board gets its own values.
- **price**: optional. Leave it out for a free widget.

### Permissions

| Permission | Lets the widget |
|---|---|
| `tasks:read` | `mypa.tasks.list()`, `mypa.tasks.onChange()` |
| `tasks:write` | `mypa.tasks.create({ title, importance })` (lands in Today), `mypa.tasks.setDone(id, done)` |
| `calendar:read` | `mypa.calendar.list({ days })` |
| `notify` | `mypa.notify(title, body)` |
| `net:<host>` | `mypa.fetch(url)` to that host over https; `net:*.example.com` covers subdomains |

Ask for as little as you can. The install sheet lists every permission in plain language.

## The runtime

Include the host's runtime and theme. They always match the user's version of myPA.

```html
<link rel="stylesheet" href="/__mypa/theme.css" />
<script src="/__mypa/sdk.js"></script>
```

**`theme.css`** gives you:

- myPA's tokens (`--ds-accent`, `--ds-fg`, `--ds-muted`, …) and Poppins;
- `.btn`, `.btn.primary`, `.btn.ghost`;
- `.field`, `.muted`, `.num`.

**`sdk.js`** defines `mypa`:

```js
mypa.ready.then(({ widget, instanceId, settings, permissions }) => {});
mypa.settings;                 // current values of your settings fields
mypa.onSettings((s) => {});

await mypa.storage.get(key);   // private to this widget instance, persisted (512 KB)
await mypa.storage.set(key, value);
await mypa.storage.remove(key);

await mypa.tasks.list();       // tasks:read
mypa.tasks.onChange((tasks) => {});
await mypa.tasks.create({ title: "Call Ada", importance: "high" }); // tasks:write
await mypa.tasks.setDone(task.id, true);                              // tasks:write
await mypa.calendar.list({ days: 7 });                              // calendar:read
const res = await mypa.fetch("https://api.example.com/x");          // net:api.example.com
await res.json();
await mypa.notify("Done", "Your export finished");                  // notify
await mypa.openUrl("https://example.com");                          // opens the browser
```

## Share it

```sh
node packages/widget-sdk/bin/mypa-widget.ts pack my-widget
```

The command writes `you.my-widget-1.0.0.mypawidget`. Anyone can install it from **Marketplace → Developer → Install from a file**. It's labelled **Unverified**, because nothing proves who made it.

## Publish a registry

A registry is a signed `registry.json` plus bundle files, hosted anywhere static (Vercel, GitHub Pages, S3).

```sh
mypa-widget keygen --out keys/registry
mypa-widget registry --src widgets/ --out public/ --key keys/registry.pem \
  --name "Acme widgets" --publishers publishers.json
```

Users add the registry URL under **Developer → Registries**.

How trust is decided:

- **Official** (black seal): widgets from a registry signed with the **myPA root key** whose publisher is marked `official`.
- **Verified publisher** (blue seal): widgets from a root-signed registry whose publisher is marked `verified`.
- **Community** (no seal): widgets from any other correctly signed registry.
- Registries whose signature doesn't match are rejected. So is any download whose sha256 doesn't match the signed index.

A `publishers.json` entry looks like this:

```json
{ "you": { "name": "Your name", "verified": false, "licenseKeyFile": "keys/you.pub.pem" } }
```

## Sell it

1. Add `price` to the manifest, pointing `checkoutUrl` at your own checkout (a Stripe Payment Link, Lemon Squeezy, Gumroad…).
2. Make a key pair (`mypa-widget keygen --out keys/you`) and reference the public half as `licenseKeyFile` in the registry's `publishers.json`.
3. After each sale, issue a key and send it to the buyer:

```sh
mypa-widget license --key keys/you.pem --widget you.my-widget --to buyer@example.com
```

The buyer pastes the key on the widget's page in the Marketplace. myPA checks the key offline against your public key from the signed registry.

## License

The SDK, the `mypa-widget` CLI and the starter template are [MIT](LICENSE). The widget runtime the app serves to widgets (`/__mypa/sdk.js`, `/__mypa/theme.css`) is MIT too. Your widgets are yours: license them however you like, open or closed, free or paid. The myPA app itself is AGPL-3.0, and that doesn't extend to widgets that run in it.
