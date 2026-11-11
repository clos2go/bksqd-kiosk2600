/**
 * ============================================================================
 * BEAKSQUAD HALLWAY SIGNAGE — GOOGLE APPS SCRIPT BACKEND (Code.gs)
 * ============================================================================
 *
 * What this file does:
 *   This script turns our BeakSquad Google Sheet into a free JSON API that both
 *   Raspberry Pi hallway screens poll every 60 seconds.
 *
 *   It reads two tabs from the Google Sheet:
 *     1. "Settings" — Key/Value pairs that control the displays (theme, mode,
 *                     manual overrides, calendar IDs, room info).
 *     2. "Slides"   — Rows of slides to rotate through on the Info Board.
 *
 *   It also checks up to 3 Google Calendars for today's all-day events to
 *   automatically figure out:
 *     - Whether today is an "A Day" or "B Day"
 *     - Whether school is closed today (Holiday, Staff Development, etc.)
 *
 * IMPORTANT DEPLOYMENT & CORS RULES (All 5 are required!):
 *   1. doGet() MUST return ContentService with MimeType.JSON. Never use HtmlService.
 *   2. The Raspberry Pi frontend must call fetch(API_URL) as a plain GET request
 *      with NO custom headers (no Content-Type, no Authorization) so the browser
 *      does not send a CORS preflight (OPTIONS) request.
 *   3. Deploy with:
 *        - Execute as: "Me" (the script owner's Google account)
 *        - Who has access: "Anyone" (NOT "Anyone with a Google account", because
 *          the Raspberry Pi kiosk is not signed into Google!)
 *   4. In kiosk/config.js, API_URL must use the "/exec" URL, never "/dev".
 *   5. Saving this file in the editor does NOT update the live API! After every
 *      code change, click:
 *      Deploy -> Manage deployments -> Edit (pencil icon) -> Version: New version -> Deploy.
 */

// Always evaluate dates in Austin, TX time (America/Chicago)
var TIMEZONE = "America/Chicago";

// Cache calendar lookups for 10 minutes (600 seconds) so we don't hit Google's
// daily Calendar quota when two Pis poll every 60 seconds.
// Note: Sheet settings and slides are NOT cached, so flipping a switch in the
// Google Sheet updates the screens within 60 seconds!
var CALENDAR_CACHE_SECONDS = 600;

/**
 * Runs automatically when a Raspberry Pi makes an HTTP GET request to the /exec URL.
 *
 * @param {Object} e - The event parameter passed by Google Apps Script.
 * @return {TextOutput} A JSON response with proper CORS-friendly headers.
 */
function doGet(e) {
  var warnings = [];
  var now = new Date();
  var todayChicago = Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd");

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Read Settings and Slides from the Google Sheet
    var settings = readSettingsSheet_(ss, warnings);
    var slides = readSlidesSheet_(ss, warnings);

    // 2. Inspect calendars (cached for 10 minutes) for A/B Day and Closures
    var bypassCache = e && e.parameter && e.parameter.nocache === "1";
    var calendarFacts = getCalendarFactsForToday_(now, todayChicago, settings, warnings, bypassCache);

    // 3. Determine whether we are closed all day
    //    Priority 1: The "Force_Closed_All_Day" checkbox in Settings
    //    Priority 2: An all-day calendar event matching Closure_Keywords
    var closedAllDay = false;
    var closedReason = null;

    if (settings.forceClosedAllDay) {
      closedAllDay = true;
      closedReason = settings.customClosedMessage || "Closed Today";
    } else if (calendarFacts.closedAllDay) {
      closedAllDay = true;
      closedReason = calendarFacts.closedReason || settings.customClosedMessage || "School Closed";
    }

    // 4. Determine today's A/B Day type
    //    Use Manual_AB_Day_Override unless it is set to "Auto"
    var dayType = null;
    var override = (settings.manualABDayOverride || "Auto").trim().toUpperCase();
    if (override === "A" || override === "A DAY") {
      dayType = "A";
    } else if (override === "B" || override === "B DAY") {
      dayType = "B";
    } else {
      dayType = calendarFacts.dayType; // "A", "B", or null
    }

    // 5. Build the JSON payload matching the frontend's expected contract
    var response = {
      date: todayChicago,
      closedAllDay: closedAllDay,
      closedReason: closedReason,
      dayType: dayType,
      customMessage: settings.customClosedMessage || "",
      theme: settings.theme || "vaporwave",
      room: {
        number: settings.roomNumber || "224",
        tagline: settings.roomTagline || "Student IT Help Desk — Walk-ins welcome",
        image: settings.infoImage || "eagle",
        mode: settings.infoMode || "rotate",
        pinnedSlideId: settings.pinnedSlideId || "HOME"
      },
      slides: slides,
      serverTime: now.toISOString(),
      warnings: warnings
    };

    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // Even if something unexpected crashes, return valid JSON so the Pi can log it
    // and fall back gracefully.
    var errorResponse = {
      date: todayChicago,
      closedAllDay: false,
      closedReason: null,
      dayType: null,
      customMessage: "",
      theme: "vaporwave",
      room: {
        number: "224",
        tagline: "Student IT Help Desk — Walk-ins welcome",
        image: "eagle",
        mode: "rotate",
        pinnedSlideId: "HOME"
      },
      slides: [],
      serverTime: now.toISOString(),
      warnings: warnings.concat(["Server error in Code.gs: " + String(err && err.message ? err.message : err)])
    };

    return ContentService
      .createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Reads the "Settings" tab (2 columns: Key, Value) into a clean object with safe defaults.
 */
function readSettingsSheet_(ss, warnings) {
  var defaults = {
    forceClosedAllDay: false,
    customClosedMessage: "",
    manualABDayOverride: "Auto",
    calendarIds: [],
    closureKeywords: ["Holiday", "Staff Development", "Testing"],
    theme: "vaporwave",
    roomNumber: "224",
    roomTagline: "Student IT Help Desk — Walk-ins welcome",
    infoImage: "eagle",
    infoMode: "rotate",
    pinnedSlideId: "HOME"
  };

  var sheet = ss.getSheetByName("Settings");
  if (!sheet) {
    warnings.push('Sheet tab "Settings" not found — using default settings.');
    return defaults;
  }

  var rows = sheet.getDataRange().getValues();
  var raw = {};

  // Start at row 0; if row 0 is a header ("Key" / "Value"), it won't hurt anything.
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i][0] || "").trim();
    var val = rows[i][1];
    if (key) {
      raw[key] = val;
    }
  }

  // Parse checkbox / boolean for Force_Closed_All_Day
  var forceVal = raw["Force_Closed_All_Day"];
  var forceClosed = (
    forceVal === true ||
    String(forceVal).trim().toUpperCase() === "TRUE" ||
    String(forceVal).trim().toUpperCase() === "YES"
  );

  // Parse comma-separated Calendar_IDs
  var calIdsRaw = String(raw["Calendar_IDs"] || "").trim();
  var calIds = calIdsRaw
    ? calIdsRaw.split(",").map(function(s) { return s.trim(); }).filter(Boolean)
    : [];

  // Parse comma-separated Closure_Keywords (fall back to default if blank)
  var kwRaw = String(raw["Closure_Keywords"] || "").trim();
  var keywords = kwRaw
    ? kwRaw.split(",").map(function(s) { return s.trim(); }).filter(Boolean)
    : defaults.closureKeywords;

  return {
    forceClosedAllDay: forceClosed,
    customClosedMessage: String(raw["Custom_Closed_Message"] || "").trim(),
    manualABDayOverride: String(raw["Manual_AB_Day_Override"] || "Auto").trim(),
    calendarIds: calIds,
    closureKeywords: keywords,
    theme: String(raw["Theme"] || defaults.theme).trim().toLowerCase(),
    roomNumber: String(raw["Room_Number"] || defaults.roomNumber).trim(),
    roomTagline: String(raw["Room_Tagline"] || defaults.roomTagline).trim(),
    infoImage: String(raw["Info_Image"] || defaults.infoImage).trim().toLowerCase(),
    infoMode: String(raw["Info_Mode"] || defaults.infoMode).trim().toLowerCase(),
    pinnedSlideId: String(raw["Pinned_Slide_ID"] || defaults.pinnedSlideId).trim()
  };
}

/**
 * Reads the "Slides" tab and returns active slides sorted by Sort_Order.
 *
 * Expected columns:
 *   Slide_ID | Sort_Order | Type | Title | Content | Note_Footer | QR_Link | IsActive
 */
function readSlidesSheet_(ss, warnings) {
  var sheet = ss.getSheetByName("Slides");
  if (!sheet) {
    warnings.push('Sheet tab "Slides" not found — no custom slides loaded.');
    return [];
  }

  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) {
    return [];
  }

  // Map column headers by name so students don't break things if they reorder columns
  var headers = rows[0].map(function(h) { return String(h || "").trim(); });
  var colIdx = {
    id: headers.indexOf("Slide_ID"),
    sortOrder: headers.indexOf("Sort_Order"),
    type: headers.indexOf("Type"),
    title: headers.indexOf("Title"),
    content: headers.indexOf("Content"),
    footer: headers.indexOf("Note_Footer"),
    qrLink: headers.indexOf("QR_Link"),
    isActive: headers.indexOf("IsActive")
  };

  // Fallback to positional indices (0..7) if headers don't match
  if (colIdx.id === -1) colIdx.id = 0;
  if (colIdx.sortOrder === -1) colIdx.sortOrder = 1;
  if (colIdx.type === -1) colIdx.type = 2;
  if (colIdx.title === -1) colIdx.title = 3;
  if (colIdx.content === -1) colIdx.content = 4;
  if (colIdx.footer === -1) colIdx.footer = 5;
  if (colIdx.qrLink === -1) colIdx.qrLink = 6;
  if (colIdx.isActive === -1) colIdx.isActive = 7;

  var slides = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var id = String(row[colIdx.id] || "").trim();
    if (!id) continue; // Skip empty rows

    var activeRaw = row[colIdx.isActive];
    var isActive = (
      activeRaw === true ||
      String(activeRaw).trim().toUpperCase() === "TRUE" ||
      String(activeRaw).trim().toUpperCase() === "YES"
    );

    var sortOrderNum = Number(row[colIdx.sortOrder]);
    if (isNaN(sortOrderNum)) sortOrderNum = 999;

    slides.push({
      id: id,
      sortOrder: sortOrderNum,
      type: String(row[colIdx.type] || "announcement").trim().toLowerCase(),
      title: String(row[colIdx.title] || "").trim(),
      content: String(row[colIdx.content] || "").trim(),
      footer: String(row[colIdx.footer] || "").trim(),
      qrLink: String(row[colIdx.qrLink] || "").trim(),
      isActive: isActive
    });
  }

  // Sort ascending by Sort_Order
  slides.sort(function(a, b) {
    return a.sortOrder - b.sortOrder;
  });

  return slides;
}

/**
 * Scans today's all-day events across all configured calendars for:
 *   1. Whole-word "A Day" or "B Day"
 *   2. Whole-word match against any term in Closure_Keywords
 *
 * Results are cached in CacheService for 10 minutes.
 */
function getCalendarFactsForToday_(now, todayChicago, settings, warnings, bypassCache) {
  var cache = CacheService.getScriptCache();
  var cacheKey = [
    "cal_v1",
    todayChicago,
    settings.calendarIds.join(","),
    settings.closureKeywords.join(",")
  ].join("|");

  if (!bypassCache && cache) {
    var cachedJson = cache.get(cacheKey);
    if (cachedJson) {
      try {
        var parsed = JSON.parse(cachedJson);
        if (parsed.warnings && parsed.warnings.length) {
          for (var w = 0; w < parsed.warnings.length; w++) {
            warnings.push(parsed.warnings[w]);
          }
        }
        return parsed;
      } catch (e) {
        // Ignore corrupt cache and re-fetch
      }
    }
  }

  var calWarnings = [];
  var dayType = null;
  var closedAllDay = false;
  var closedReason = null;

  if (!settings.calendarIds || settings.calendarIds.length === 0) {
    calWarnings.push("No Calendar_IDs configured in the Settings tab.");
  }

  // Build Midnight-to-Midnight window in America/Chicago for today
  var parts = todayChicago.split("-");
  var year = Number(parts[0]);
  var month = Number(parts[1]) - 1;
  var day = Number(parts[2]);
  var dayForEvents = new Date(year, month, day, 12, 0, 0);

  for (var i = 0; i < settings.calendarIds.length; i++) {
    var calId = settings.calendarIds[i];
    var cal = null;
    try {
      cal = CalendarApp.getCalendarById(calId);
    } catch (err) {
      cal = null;
    }

    // IMPORTANT: CalendarApp.getCalendarById() returns null for a public calendar
    // unless the script owner's Google account has subscribed to it in Google Calendar!
    if (!cal) {
      var msg = "Calendar " + calId + " not found — subscribe to it in Google Calendar";
      Logger.log(msg);
      calWarnings.push(msg);
      continue;
    }

    var events = [];
    try {
      events = cal.getEventsForDay(dayForEvents);
    } catch (err) {
      calWarnings.push("Could not read events from calendar " + calId + ": " + String(err));
      continue;
    }

    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      if (!ev.isAllDayEvent()) {
        continue; // Only inspect all-day events for A/B Day and school-wide closures
      }

      var title = String(ev.getTitle() || "").trim();
      if (!title) continue;

      // Check for whole-word "A Day" or "B Day"
      if (!dayType) {
        if (matchesWholeWord_(title, "A Day")) {
          dayType = "A";
        } else if (matchesWholeWord_(title, "B Day")) {
          dayType = "B";
        }
      }

      // Check for whole-word closure keywords
      // Note: We prevent phrases like "AP Testing Info Session" from triggering a
      // closure by requiring whole-word matching AND ignoring informational sessions.
      if (!closedAllDay && !/\binfo\s+session\b/i.test(title)) {
        for (var k = 0; k < settings.closureKeywords.length; k++) {
          var keyword = settings.closureKeywords[k];
          if (keyword && matchesWholeWord_(title, keyword)) {
            closedAllDay = true;
            closedReason = title;
            break;
          }
        }
      }
    }
  }

  for (var c = 0; c < calWarnings.length; c++) {
    warnings.push(calWarnings[c]);
  }

  var result = {
    dayType: dayType,
    closedAllDay: closedAllDay,
    closedReason: closedReason,
    warnings: calWarnings
  };

  if (cache) {
    try {
      cache.put(cacheKey, JSON.stringify(result), CALENDAR_CACHE_SECONDS);
    } catch (e) {
      // Cache write failure is non-fatal
    }
  }

  return result;
}

/**
 * Checks whether `text` contains `phrase` as a whole word (case-insensitive).
 *
 * Why whole-word matching matters:
 *   A naive `.includes("A")` or substring check would match inside other words,
 *   and for single-title closure keywords we check word boundaries cleanly.
 *   In addition, if an event title is a multi-word informational event like
 *   "AP Testing Info Session" while the keyword is "Testing", we only want
 *   standalone/whole-phrase closure events or exact word matches that aren't
 *   "Info Session" notices.
 *
 * @param {string} text   - The calendar event title to test.
 * @param {string} phrase - The keyword or phrase (e.g. "A Day", "Holiday", "Testing").
 * @return {boolean} True if matched as a whole word.
 */
function matchesWholeWord_(text, phrase) {
  if (!text || !phrase) return false;
  var escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var regex = new RegExp("(?:^|\\b)" + escaped + "(?:\\b|$)", "i");
  return regex.test(text);
}
