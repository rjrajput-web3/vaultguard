# VAULTRY — Brand Identity

**Built as VAULTGUARD, renamed VAULTRY for public launch.** The underlying NEAR
security contract remains `vaultguard.vgdeployer.testnet`. The GitHub repo name
stays `vaultguard`.

The mark: a geometric shield whose "V" letterform is built from **three connected
blockchain nodes** — two link-arms joining at a vertex node. Multichain
protection, drawn as one glyph.

## Files

| File | Use |
|---|---|
| `logo.svg` | Full lockup (mark + wordmark), **dark wordmark `#0b1220`** — for light backgrounds |
| `logo-light.svg` | Full lockup, **light wordmark `#eef4fb`** — for dark backgrounds |
| `icon.svg` / `favicon.svg` | Standalone shield+V mark, no wordmark |
| `favicon-32.png`, `favicon-16.png` | Raster favicons, transparent background |
| `apple-touch-icon.png` | 180×180, navy rounded-square tile (iOS flattens transparency) |
| `logo-transparent.png` | 1024×262, transparent |
| `icon-transparent.png` | 512×512, transparent |

All SVGs are hand-crafted vectors (no raster art, no clipart). PNGs were rendered
from the SVGs in headless Chromium via CDP `Page.captureScreenshot` with a
transparent background override — corners verified alpha 0, mark fully opaque.

## Color palette

| Token | Hex | Use |
|---|---|---|
| Deep navy 0 | `#04070f` | Primary background, shield fill base |
| Deep navy 1 | `#070b16` | Section background |
| Deep navy 2 | `#0a1020` | Shield fill top, panels |
| Electric blue | `#3b82f6` | Primary brand, gradient start, buttons |
| Electric cyan | `#22d3ee` | Primary brand, gradient end, accents, glows |
| Ice | `#7dd3fc` | Highlights, node tops, gradient text |
| Node core | `#eafcff` | Node radial highlight |
| Ink | `#0b1220` | Wordmark on light backgrounds |
| Paper | `#eef4fb` | Wordmark on dark backgrounds |
| Text | `#e9eef7` | Body copy on dark |
| Muted | `#93a0b8` | Secondary copy |
| Success | `#22c55e` | SAFE state |
| Warning | `#f59e0b` | CAUTION state |
| Danger | `#ef4444` | BLOCKED state |

**Gradients (never flat where a gradient is defined):**
- Shield stroke / brand sweep: `#3b82f6 → #22d3ee` (diagonal, top-left to bottom-right)
- V arms: `#7dd3fc → #22d3ee → #3b82f6` (left to right)
- Nodes: radial `#eafcff → #7dd3fc → #22d3ee` (highlight top-left)
- Shield fill: `#0a1020 → #04070f` (top to bottom)

Matches `apps/web/app/globals.css` design tokens (`--bg-0…--bg-2`, `--blue`, `--cyan`, `--ice`).

## Typography

- **Wordmark:** geometric/grotesque sans, weight 800, all caps, letter-spacing
  ≈ 12% of cap height. Preferred: Inter ExtraBold; fallback stack
  `"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`.
- **Product/UI:** same sans stack as `globals.css` (system stack). Headings 700–800,
  tight letter-spacing; body 400–500.
- **Mono (addresses, hashes, tx data):** `ui-monospace, "SF Mono", Menlo, Consolas, monospace`.
- Never set the wordmark in a serif, script, or rounded font. Never retype it in a
  different weight — use the SVG lockups.

## Usage rules

**Clear space:** keep a margin of at least the shield's stroke-width × 4 (the "V"
node diameter) on all sides of the mark; one full icon width on all sides of the
full lockup.

**Minimum size:**
- Full lockup: ≥ 120 px wide (print ≥ 32 mm)
- Icon alone: ≥ 16 px (favicon sizes provided; below 24 px prefer `favicon.svg`
  rendering over the detailed PNG)

**Pairing:**
- On dark navy / dark imagery → `logo-light.svg`
- On white / light surfaces → `logo.svg`
- Never place the dark wordmark on the navy background or the light wordmark on
  white — contrast fails both ways.

**Do NOT:**
- Recolor the mark (no red/green/purple VaultGuard; status colors live in the UI,
  not the logo)
- Add drop shadows, outlines, bevels, or glows beyond the built-in node halos
- Stretch, squeeze, or rotate the mark (an anamorphic squeeze once shipped in a
  video mockup — never again)
- Place the mark on busy photography without a navy scrim
- Use the favicon PNGs scaled *up* — use `icon.svg` / `icon-transparent.png`
- Put text, badges, or "TM"-style clutter inside the clear space
- Redraw the "V" or separate the nodes from the arms — the mark is one unit
