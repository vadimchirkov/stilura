# Stilura visual reference for the demo animation

Pulled from `public/style.css`, `src/editor/theme.js`, `extension/editor-ui.js` (bundled into `public/app.js`), and the running app (light theme, 1280×800). Use these values so the animation reads as the real app.

## Overall look

- Almost empty window: warm paper background, one centred column of monospace prose, no chrome except a sidebar icon (top left), a gear (top right) and a quiet shortcut line at the bottom.
- No cards, no shadows on the page. Contrast comes from tint, not borders.
- Two fonts only: iA Writer Duo for the prose, system UI (SF Pro on macOS) for everything else.

## Colour (light theme, the one the video uses)

| Token | Value | Used for |
|---|---|---|
| `--bg` / `--surface` | `#f7f5f0` | the page (warm paper) |
| `--surface-2` | `#f0ede5` | hover, key badge fill, skeleton highlight |
| `--surface-3` | `#e6e2d8` | pressed, skeleton base, slash-loading strip |
| `--text` | `#0d0d0d` | prose |
| `--text-2` | `#5d5d5d` | key names in the shortcut line |
| `--muted` | `#6b6b6b` | hints, labels |
| `--accent` | `#316ecf` | caret, focus rings, dashed variant underline |
| `--attached-tint` | `color-mix(in srgb, #316ecf 18%, #f7f5f0)` ≈ `#d6dee9` | selection, slash request line, applied flash |
| `--primary-bg` / `--primary-fg` | `#0d0d0d` / `#ffffff` | the ⌘K request bubble |
| `--ok` | `#367f3e` | added text tint (42% mix) |
| `--danger` | `#911e1b` | removed text tint (24% mix), spelling squiggle |
| `--border` | `#0000001a` | key badge outline |

Dark theme for reference: bg `#111111`, surface `#212121`, text `#ffffff`, muted `#afafaf`, accent `#63a8f8`, bubble inverts to white with `#0d0d0d` text.

## Typography

- Prose: `'iA Writer Duo'` (files in `public/fonts/`, weights 400/700 + italics), **17px, line-height 1.75** (≈30px rows), colour `--text`.
- Column: measure between **52ch and 68ch**, centred; top padding 48px. At 1280px wide the column starts at x≈288px and lines wrap at ~60 characters.
- Paragraph gap: one empty line (one 30px row).
- UI text: `system-ui, -apple-system, 'Segoe UI', sans-serif`. Body 13px (most common), 14px secondary, 15px for card titles. Weights 400 and 500; 600/700 only for headings in dialogs.
- Shortcut line (bottom centre): 13px/1.4 system UI, `--muted`; key names (`/`, `Tab`, `R`) weight 500 in `--text-2`. Items 20px apart: "/ generate text   Tab accept   R regenerate". Fades up from a gradient over the last 32px.

## Editor states to show

- **Caret**: 1.5px wide, `--accent` blue.
- **Selection**: `--attached-tint` drawn on the characters only (not full width), 2px radius, `box-decoration-break: clone` so each wrapped line is its own block.
- **⌘K request bubble**: appears 10px below the selection, left-aligned to it. Black pill `#0d0d0d`, white text, 13px/1.5 system UI, padding 7px 10px, radius 7px, min width 160px, max 360px, grows with content, no shadow. Placeholder at 60% opacity, rotates through: "Too much?", "Say it plainly.", "Does this land?", "Find a better word.", "What's missing?", "Tighten this."
- **Completion hint under bubble**: smaller black chip, 12px/1.5, padding 3px 10px, radius 5px, 3px gap.
- **Busy passage (skeleton)**: text goes transparent; each wrapped line becomes a word-shaped block with radius 4px and a sheen: gradient `#e6e2d8 25% → #f0ede5 37% → #e6e2d8 63%`, background-size 400%, sliding right→left over **1.4s ease-in-out**, infinite.
- **Rewrite variant preview**: replacement text on paper background with a **1px dashed `--accent` underline**, radius 4px.
- **Applied text**: brief blue wash, `--attached-tint` fading to transparent over **1.2s ease-out**.
- **Slash request** (`/` at line start): the whole line becomes an `--attached-tint` strip across the column (inset 0.42em left), the slash itself hidden. While generating, the strip turns `--surface-3`.
- **Ghost autocomplete**: same font and colour as prose at **45% opacity**, right after the caret.
- **Key badge** (chat pill style, good for on-screen key overlays): 13px system UI, `--muted` text, 1px `--border`, radius 4px, padding 1px 5px, fill `--surface-2`.

## Motion tokens

| What | Duration | Easing |
|---|---|---|
| General ease | — | `cubic-bezier(.16, 1, .3, 1)` |
| Modal / dropdown in | 250ms, from scale .96 / .97 | `cubic-bezier(.22, 1, .36, 1)` |
| Modal / dropdown out | 150ms | same |
| Tooltip in / out | 150ms / 50ms | ease-out |
| Toast in / out | 350ms / 250ms | `cubic-bezier(.22, 1, .36, 1)` |
| Icon swap | 250ms, scale .25→1, blur 2px→0 | ease-in-out |
| Chat island expand / settle | 450ms / 300ms | `cubic-bezier(.32, .72, 0, 1)` |
| Island enter | opacity 0→1 + blur 4px→0 by 60% | — |
| Toggle | 350ms | `cubic-bezier(.34, 1.35, .64, 1)` (slight overshoot) |
| Error shake | 6px, 80ms + 60ms | `cubic-bezier(.22, 1, .36, 1)` |
| Focus mode dim | other paragraphs to 28% opacity, 200ms | ease |
| Skeleton sheen | 1.4s loop | ease-in-out |
| Applied flash | 1.2s | ease-out |

Character: fast entries (150–250ms), faster exits, strong ease-out, small scale changes (0.96–0.97, never from 0), blur instead of slides. Nothing bounces except the toggle.

## Radii and shadows

Radii: 4px (marks, badges), 6px (small buttons), 7px (⌘K bubble), 10px (fields), 20px (overlays, chat island), pill 999px.
Shadows (only on floating overlays): sm `0 1px 2px #00000014`, md `0 4px 16px #0000001f`, lg `0 12px 40px #0000002e`.
