/**
 * ============================================================================
 * BEAKSQUAD HALLWAY SIGNAGE — CONFIGURATION (kiosk/config.js)
 * ============================================================================
 *
 * Welcome, BeakSquad Techs!
 * If you need to change bell schedule times, transition buffers, closure
 * messages, slide rotation speed, or the Google Apps Script API URL, edit the
 * values in this file. You should not need to touch the other .js files.
 */

window.BEAKSQUAD_CONFIG = {
  // --------------------------------------------------------------------------
  // 1. GOOGLE APPS SCRIPT API
  // --------------------------------------------------------------------------
  // IMPORTANT:
  //   - Always use the "/exec" deployment URL from Google Apps Script.
  //   - NEVER use the "/dev" URL (it requires a Google login and will fail on the Pi).
  API_URL: "https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec",

  // How often (in seconds) each Pi polls the Google Sheet API for updates.
  POLL_INTERVAL_SECONDS: 60,

  // Show the full-width "OFFLINE — TIMES MAY BE INACCURATE" warning banner
  // if the Pi has not had a successful fetch in this many minutes.
  OFFLINE_WARNING_MINUTES: 240,

  // If the Pi's local clock differs from Google's serverTime by more than this
  // many seconds, automatically correct the clock and show a small warning dot.
  CLOCK_DRIFT_THRESHOLD_SECONDS: 60,

  // --------------------------------------------------------------------------
  // 2. DISPLAY & KIOSK TIMING
  // --------------------------------------------------------------------------
  // Always calculate bell schedules in Austin, TX time (never trust the Pi OS timezone).
  TIMEZONE: "America/Chicago",

  // Info Board: how long each slide stays on screen when Info_Mode = "rotate"
  SLIDE_DURATION_MS: 10000,      // 10 seconds per slide
  SLIDE_CROSSFADE_MS: 400,       // 400 ms crossfade between slides

  // Screen longevity / reliability settings
  PIXEL_SHIFT_INTERVAL_MINUTES: 10, // Shift layout by 1-2px every 10 min to prevent burn-in
  PIXEL_SHIFT_MAX_PX: 2,
  DAILY_RELOAD_HOUR: 3,             // Reload the browser every day at 3:00 AM
  DAILY_RELOAD_MINUTE: 0,

  // --------------------------------------------------------------------------
  // 3. DEFAULT ROOM & APPEARANCE FALLBACKS
  //    (Used before the first API fetch completes or if a Sheet cell is blank)
  // --------------------------------------------------------------------------
  DEFAULT_THEME: "vaporwave",
  DEFAULT_ROOM: {
    number: "224",
    tagline: "Student IT Help Desk — Walk-ins welcome",
    image: "eagle",          // "eagle" | "teacher" | "none"
    mode: "rotate",          // "rotate" | "pinned"
    pinnedSlideId: "HOME"    // "HOME" or any Slide_ID from the Google Sheet
  },
  OPEN_STATUS_MESSAGE: "Walk-ins welcome — bring your Chromebook & charger.",

  // Starter slides shown if the Pi boots offline before its very first API fetch
  DEFAULT_SLIDES: [
    {
      id: "CHROMEBOOK_RESTART",
      sortOrder: 10,
      type: "command",
      title: "Chromebook Frozen? Force a Hard Reset",
      content: "Hold `Refresh` + tap `Power` to reboot your Chromebook without losing your Google Docs.",
      footer: "Works on all district Chromebooks",
      qrLink: "https://support.google.com/chromebook/answer/3227606?hl=en&ref=beaksquad",
      isActive: true
    },
    {
      id: "WIFI_FIX",
      sortOrder: 20,
      type: "tip",
      title: "Stuck on \"Connecting\" to Campus Wi-Fi?",
      content: "Open Chrome and visit `http://neverssl.com` to force the district login portal to appear.",
      footer: "Have your student ID ready",
      qrLink: "",
      isActive: true
    },
    {
      id: "TICKET_QR",
      sortOrder: 30,
      type: "announcement",
      title: "Skip the Line — Submit a Repair Ticket",
      content: "Broken screen or missing key? Scan the QR code to pre-fill a repair ticket before walking in.",
      footer: "Bring your charger with your device",
      qrLink: "https://forms.gle/BeakSquadTicketDemo?room=224&source=kiosk",
      isActive: true
    }
  ],

  // --------------------------------------------------------------------------
  // 4. BELL SCHEDULE & TRANSITION BUFFERS
  // --------------------------------------------------------------------------
  // Standard number of minutes the shop closes BEFORE a transition (period end/start)
  // so student techs can wrap up tickets and get to their next class on time.
  BUFFER_MINUTES: 15,

  // Shorter (or longer) buffers at specific clock times. "HH:MM": minutes
  TRANSITION_OVERRIDES: {
    "12:50": 5,   // Period 2 ends / B Lunch starts → stay open until 12:45
  },

  // Bell Schedule blocks (checked in array order for closed blocks).
  // Note: Lunches are split and overlap Period 2. Lunch blocks are always closed,
  // whatever overlaps them.
  SCHEDULE: [
    { id: "p1",     name: { A: "1st Period", B: "5th Period" }, start: "09:05", end: "10:35", shopOpen: true },
    { id: "eagle",  name: "Eagle Time", start: "10:40", end: "11:10", shopOpen: true, noBuffer: true },
    { id: "alunch", name: "A Lunch",    start: "11:10", end: "11:45", shopOpen: false,
      closedMessage: "Team break. Our techs need snacks too." },
    { id: "p2",     name: { A: "2nd Period", B: "6th Period" }, start: "11:15", end: "12:50",
      shopOpen: true, closedOnDays: ["B"], closedMessage: "6th Period. Back after B Lunch." },
    { id: "blunch", name: "B Lunch",    start: "12:50", end: "13:25", shopOpen: false,
      closedMessage: "Out to lunch. Literally." },
    { id: "p3",     name: { A: "3rd Period", B: "7th Period" }, start: "13:30", end: "15:00", shopOpen: true },
    { id: "p4",     name: { A: "4th Period", B: "8th Period" }, start: "15:05", end: "16:35", shopOpen: true },
  ],

  // Standard closure reasons shown on the Status Board
  REASONS: {
    weekend:      { title: "Weekend",       message: "Even techs need to recharge. See you Monday." },
    noClasses:    { title: "No Classes",    message: "No school today. Enjoy it." },
    beforeSchool: { title: "Before School", message: "Booting up..." },
    shiftChange:  { title: "Shift Change",  message: "Swapping techs. Back in a few." },
    afterSchool:  { title: "After School",  message: "Go home. Seriously." },
  }
};
