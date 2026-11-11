# BeakSquad Hallway Signage System

A two-screen hallway signage system for **BeakSquad**, our student-run high school IT help desk. Built with plain HTML, CSS, and JavaScript (no frameworks, no build step, no `npm`) so first-year Computer Science and IT Practicum students can read, maintain, and extend every file.

> [!IMPORTANT]
> **STOP — Check District Google Workspace Policy First!**
> Before building or wiring up your Raspberry Pis, confirm that your school district allows Google Apps Script Web Apps to be deployed with **Who has access: "Anyone"** (anonymous access).
> Because the Raspberry Pis run in an unattended kiosk mode without being signed into a Google account, `"Anyone within <District>"` or `"Anyone with a Google account"` will redirect the Pi to a Google login page and fail with a CORS error. Test this first with a dummy script or deploy from a non-restricted account that subscribes to the public school calendars.

---

## Architecture Overview

Two Raspberry Pis each drive a 1920×1080 (16:9 landscape) monitor running Chromium in kiosk mode. Both Pis run the **exact same codebase** and choose their role via a URL parameter:

| Screen | URL | Role |
| :--- | :--- | :--- |
| **Pi 1 — Info Board** | `http://localhost:8000/?display=info` | Shows the HOME screen (room number, tagline, eagle/teacher graphic) and rotates or pins slides from the Google Sheet, with optional scannable QR codes and an OPEN/CLOSED corner pill. |
| **Pi 2 — Status Board** | `http://localhost:8000/?display=status` | Shows a giant `OPEN` or `CLOSED` header, current reason, live countdown to the next change, today's open windows (highlighted/dimmed), live clock, and A/B Day badge. |

### Repository Layout

```text
beaksquad-kiosk/
├── apps-script/
│   └── Code.gs              # doGet() JSON API + Google Calendar A/B & closure logic
├── kiosk/
│   ├── index.html           # Entry point; loads role from ?display=info or ?display=status
│   ├── config.js            # Bell schedule, buffers, closure messages, timing, API URL
│   ├── schedule.js          # Pure getStatus() logic (America/Chicago, zero DOM access)
│   ├── app.js               # Fetch loop, localStorage cache, clock-drift fix, display router
│   ├── displays/
│   │   ├── info.js          # Info Board rendering (HOME, slide rotation, pin mode, QR codes)
│   │   └── status.js        # Status Board rendering (OPEN/CLOSED, countdown, open windows)
│   ├── styles/
│   │   └── base.css         # Layout & typography rules ONLY — every color/font is a var()
│   ├── themes/
│   │   ├── vaporwave.css    # Default theme (custom property overrides only)
│   │   └── core.css         # Akins Navy/Gold theme (custom property overrides only)
│   ├── fonts/               # Self-hosted WOFF2 fonts (no external CDN dependencies)
│   └── assets/              # Local SVG graphics (eagle.svg, teacher.svg)
├── tests/
│   └── schedule.test.html   # Browser-based unit test runner for schedule.js
└── README.md                # This guide
```

---

## 1. Google Sheet Setup

Create a new Google Sheet with **two tabs** named exactly `Settings` and `Slides`.

### Tab 1: `Settings` (Key / Value rows)

Create two columns (`Key` in Column A, `Value` in Column B):

| Key (Column A) | Sample Value (Column B) | Input Type / Notes |
| :--- | :--- | :--- |
| `Force_Closed_All_Day` | `FALSE` | Checkbox (`TRUE` / `FALSE`). Closes the shop all day immediately. |
| `Custom_Closed_Message` | `Closed for inventory — back tomorrow!` | Text shown when `Force_Closed_All_Day` is checked (or as fallback). |
| `Manual_AB_Day_Override` | `Auto` | Dropdown: `Auto`, `A Day`, `B Day`. |
| `Calendar_IDs` | `cal1@group.calendar.google.com, cal2@...` | Comma-separated list of up to 3 public Google Calendar IDs. |
| `Closure_Keywords` | `Holiday, Staff Development, Testing` | Comma-separated whole-word keywords that mark an all-day event as a closure. |
| `Theme` | `vaporwave` | Dropdown: `vaporwave` (default), `core`. |
| `Room_Number` | `224` | Text shown on the Info Board HOME screen. |
| `Room_Tagline` | `Student IT Help Desk — Walk-ins welcome` | Text shown under the room number on HOME. |
| `Info_Image` | `eagle` | Dropdown: `eagle`, `teacher`, `none` (loads from `kiosk/assets/`). |
| `Info_Mode` | `rotate` | Dropdown: `rotate`, `pinned` — the student-controlled mode switch. |
| `Pinned_Slide_ID` | `HOME` | Text (default `HOME`). Slide ID to hold when `Info_Mode` is `pinned`. |

### Tab 2: `Slides` (Shown on the Info Board)

Put the column headers in **Row 1**, and add these 3 starter rows in Rows 2–4:

| Slide_ID | Sort_Order | Type | Title | Content | Note_Footer | QR_Link | IsActive |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `CHROMEBOOK_RESTART` | `10` | `command` | `Chromebook Frozen? Force a Hard Reset` | ``Hold `Refresh` + tap `Power` to reboot your Chromebook without losing your Google Docs.`` | `Works on all district Chromebooks` | `https://support.google.com/chromebook/answer/3227606?hl=en&ref=beaksquad` | `TRUE` |
| `WIFI_FIX` | `20` | `tip` | `Stuck on "Connecting" to Campus Wi-Fi?` | ``Open Chrome and visit `http://neverssl.com` to force the district login portal to appear.`` | `Have your student ID ready` | `` | `TRUE` |
| `TICKET_QR` | `30` | `announcement` | `Skip the Line — Submit a Repair Ticket` | ``Broken screen or missing key? Scan the QR code to pre-fill a repair ticket before walking in.`` | `Bring your charger with your device` | `https://forms.gle/BeakSquadTicketDemo?room=224&source=kiosk` | `TRUE` |

- **Column notes**:
  - `Type` dropdown: `announcement` (Card A), `tip` (Card A), or `command` (Card B with monospace accent).
  - `Content`: Wrap any keyboard shortcut or terminal command in backticks (`` `Refresh` ``) to render it as a styled monospace code badge or block. Keep slides under ~40 words and code blocks under 6 lines.
  - `QR_Link`: Optional URL. Rendered automatically as a high-contrast black-on-white QR code at `22vh`.
  - `IsActive`: Checkbox (`TRUE` / `FALSE`). Uncheck to hide a slide without deleting it.

---

## 2. Google Calendar & Apps Script Deployment

### Step 2.1: Subscribe to the 3 Public Calendars FIRST
`CalendarApp.getCalendarById()` in Google Apps Script **returns `null` for a public calendar unless the script owner's Google account is subscribed to it**.
1. Logged into the Google account that will own the script, open [Google Calendar](https://calendar.google.com).
2. In the left sidebar next to **Other calendars**, click `+` → **Subscribe to calendar** (or **From URL**).
3. Add all 3 public school calendars (e.g., District Academic Calendar, A/B Day Schedule Calendar, Campus Events Calendar).
4. Copy each calendar's **Calendar ID** from Calendar Settings → *Integrate calendar* and paste them comma-separated into `Calendar_IDs` in the `Settings` sheet.
5. If a calendar is ever missing or unsubscribed, `Code.gs` will not crash — it adds `"Calendar <id> not found — subscribe to it in Google Calendar"` to the JSON `warnings` array so you can open the API URL in any browser and see what's wrong.

### Step 2.2: Deploy `apps-script/Code.gs` and Follow the 5 CORS Rules
1. In your Google Sheet, click **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](file:///Users/bksqd01/AntiProjects/beaksquad-kiosk/apps-script/Code.gs) and save (`Ctrl+S` / `Cmd+S`).
3. Click **Deploy → New deployment** → select type **Web app**:
   - **Description**: `BeakSquad Signage API v1`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Click **Deploy**, authorize the script when prompted, and copy the **Web app URL** (ending in `/exec`).
5. Paste that `/exec` URL into `API_URL` inside [`kiosk/config.js`](file:///Users/bksqd01/AntiProjects/beaksquad-kiosk/kiosk/config.js).

#### The 5 Mandatory CORS Rules (Do Not Break These!)
1. **Use `ContentService` only**: `doGet()` must return `ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON)`. Never use `HtmlService`.
2. **Plain `fetch(API_URL)` with NO custom headers**: The frontend must send a simple `GET` with no `Content-Type` or `Authorization` headers. Custom headers trigger a browser `OPTIONS` preflight request that Apps Script refuses to answer.
3. **Who has access = "Anyone"**: Never select `"Anyone with a Google account"`. The Raspberry Pi is not logged into Google and will receive an HTML login redirect that fails as a CORS error.
4. **Always use the `/exec` URL**: Never put the `/dev` test URL in `config.js` (`/dev` requires an active Google login session).
5. **Saving does NOT update the live API**:
   > [!WARNING]
   > Pressing Save in the Apps Script editor does **not** update the live `/exec` endpoint! After **every** change to `Code.gs`, you must click:
   > **Deploy → Manage deployments → Edit (pencil icon) → Version: New version → Deploy**.
   > Editing the existing deployment keeps your `/exec` URL identical so you don't have to touch the Raspberry Pis.

---

## 3. Raspberry Pi Kiosk Setup

### Step 3.1: Verify School Network Web Filter
From the Raspberry Pi terminal, confirm that the school network allows access to both Google Apps Script and the QR code generator:

```bash
curl -ILs https://script.google.com | head -n 5
curl -ILs "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=test" | head -n 5
```

*(If `api.qrserver.com` is blocked by the school filter, the Info Board automatically catches `onerror`, hides the broken image, and displays a clean readable URL fallback instead.)*

### Step 3.2: Set Timezone & Check NTP
Set the Pi's system timezone to `America/Chicago` (though `schedule.js` also forces `America/Chicago` via `Intl.DateTimeFormat` and corrects clock drift using `serverTime` from the API):

```bash
sudo timedatectl set-timezone America/Chicago
timedatectl status
```

*Note on Clock Drift*: Because a Raspberry Pi has no battery-backed hardware clock and many school networks block UDP port 123 (NTP), `app.js` compares the Pi's clock against `serverTime` in every API response. If they differ by more than 60 seconds, the Pi automatically applies the offset to all schedule calculations and displays a tiny clock-drift indicator dot.

### Step 3.3: Serve Over Local HTTP (Never `file://`)
Opening `index.html` directly via `file://` breaks self-hosted `@font-face` fonts and makes `localStorage` unreliable in Chromium. Each Pi runs Python's built-in HTTP server bound strictly to `127.0.0.1` so it is only reachable from that Pi:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory /home/pi/beaksquad-kiosk/kiosk
```

#### Auto-start the HTTP Server at Boot (`systemd`)
Create `/etc/systemd/system/beaksquad-kiosk-server.service`:

```ini
[Unit]
Description=BeakSquad Kiosk Local HTTP Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/beaksquad-kiosk/kiosk
ExecStart=/usr/bin/python3 -m http.server 8000 --bind 127.0.0.1 --directory /home/pi/beaksquad-kiosk/kiosk
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now beaksquad-kiosk-server.service
```

### Step 3.4: Chromium Kiosk Autostart & Screen Blanking Disable

Create `/home/pi/beaksquad-kiosk/start-kiosk.sh` (make it executable with `chmod +x /home/pi/beaksquad-kiosk/start-kiosk.sh`):

```bash
#!/usr/bin/env bash
# Disable X11 screen blanking and DPMS power saving
xset s off
xset s noblank
xset -dpms

# Wait until the local Python HTTP server is listening on port 8000
until curl -sf http://127.0.0.1:8000/ > /dev/null; do
  sleep 1
done

# Pick the URL for this Pi:
#   Pi 1 (Info Board):   http://localhost:8000/?display=info
#   Pi 2 (Status Board): http://localhost:8000/?display=status
KIOSK_URL="http://localhost:8000/?display=info"

exec chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --check-for-update-interval=31536000 \
  --OverscrollHistoryNavigation=0 \
  "$KIOSK_URL"
```

Add it to `/etc/xdg/lxsession/LXDE-pi/autostart` (or `~/.config/lxsession/LXDE-pi/autostart`):

```text
@lxpanel --profile LXDE-pi
@pcmanfm --desktop --profile LXDE-pi
@/home/pi/beaksquad-kiosk/start-kiosk.sh
```

- On **Pi 1**, set `KIOSK_URL="http://localhost:8000/?display=info"`.
- On **Pi 2**, set `KIOSK_URL="http://localhost:8000/?display=status"`.

### Step 3.5: Optional Nightly Monitor Power-Off (`cron`)
To save energy and extend panel life overnight, run `crontab -e` on each Pi to turn HDMI output off at 6:00 PM and back on at 7:00 AM on weekdays:

```cron
# Turn monitor off at 6:00 PM every day
0 18 * * * DISPLAY=:0 xrandr --output HDMI-1 --off || wlr-randr --output HDMI-A-1 --off

# Turn monitor back on at 7:00 AM Monday–Friday
0 7 * * 1-5 DISPLAY=:0 xrandr --output HDMI-1 --auto || wlr-randr --output HDMI-A-1 --on
```

---

## 4. Testing & Adding Future Holiday Themes

### Running the Schedule Unit Tests
Open [`tests/schedule.test.html`](file:///Users/bksqd01/AntiProjects/beaksquad-kiosk/tests/schedule.test.html) in any browser (or visit `http://localhost:8000/../tests/schedule.test.html` if serving the repo root) to verify all A Day / B Day open windows, lunch overlaps, transition buffers, and weekend/closure rules.

### Testing Specific Times on Either Display
Append `?now=YYYY-MM-DDTHH:MM&day=A|B` to either display URL to simulate any date, time, and day type:
- `http://localhost:8000/?display=status&now=2026-11-12T11:20&day=B`
- `http://localhost:8000/?display=info&now=2026-11-12T12:47&day=A`

### Adding a New Theme (e.g., `thanksgiving` or `winter`)
1. Copy [`kiosk/themes/vaporwave.css`](file:///Users/bksqd01/AntiProjects/beaksquad-kiosk/kiosk/themes/vaporwave.css) to `kiosk/themes/<theme-name>.css` (for example, `kiosk/themes/thanksgiving.css`) and update only the CSS custom properties (`--page-bg`, `--card-a-bg`, etc.), keeping text contrast ≥ 7:1.
2. Add `<theme-name>` as a dropdown option in the `Theme` row of the Google Sheet `Settings` tab. Nothing else in the codebase needs to change!
