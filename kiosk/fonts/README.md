# Self-Hosted Fonts (`kiosk/fonts/`)

To ensure the Raspberry Pi kiosks work reliably even when the school internet is down or when external font CDNs are blocked, all fonts are self-hosted right here in `kiosk/fonts/` and loaded via `@font-face` in [`kiosk/styles/base.css`](file:///Users/bksqd01/AntiProjects/beaksquad-kiosk/kiosk/styles/base.css).

## Expected Font Files

Place the following `.woff2` files in this folder (available free from Google Fonts or [google-webfonts-helper](https://gwfh.mranftl.com/fonts)):

| Filename | Font Family | Role in Akins Design System |
| :--- | :--- | :--- |
| `PressStart2P-Regular.woff2` | `"Press Start 2P"` | `--font-display` (Vaporwave theme — `OPEN`/`CLOSED` word & Room Number only) |
| `Orbitron-Bold.woff2` | `"Orbitron"` | `--font-display` (Core theme — `OPEN`/`CLOSED` word & Room Number only) |
| `VT323-Regular.woff2` | `"VT323"` | `--font-digits` (Live clock, window times, countdown) |
| `SpaceGrotesk-Regular.woff2` | `"Space Grotesk"` | `--font-body` (Slide sentences, reason messages, headings) |
| `ShareTechMono-Regular.woff2` | `"Share Tech Mono"` | `--font-code` (Backtick code snippets & command slides) |

> **Why serve over `http://localhost:8000` instead of `file://`?**
> Chromium blocks `@font-face` `url(...)` requests from `file://` URLs due to browser cross-origin security rules. Always run the local Python HTTP server (`python3 -m http.server 8000 --bind 127.0.0.1`) so these self-hosted fonts load properly!
