/**
 * ============================================================================
 * BEAKSQUAD HALLWAY SIGNAGE — APPLICATION CONTROLLER (kiosk/app.js)
 * ============================================================================
 *
 * What this file does:
 *   1. Reads URL parameters:
 *        - `?display=info` or `?display=status` (selects which board to render)
 *        - `?now=2026-11-12T11:20&day=B` (optional testing override for both boards)
 *        - `?theme=vaporwave` or `?theme=core` (optional theme preview override)
 *   2. Polls the Google Apps Script JSON API every 60 seconds using a plain
 *      `fetch(API_URL)` with NO custom headers (so we never trigger a CORS
 *      preflight request).
 *   3. Caches the last good API response, its fetch timestamp, and the clock-drift
 *      offset in `localStorage` so the kiosk survives Wi-Fi dropouts or reboots.
 *   4. Fixes Raspberry Pi clock drift: compares `serverTime` from the API with the
 *      Pi's local clock. If they differ by > 60 seconds, applies the offset to all
 *      time calculations and lights up a small clock-drift indicator dot.
 *   5. Manages the offline indicator dot and the full-width warning banner
 *      ("OFFLINE — TIMES MAY BE INACCURATE") when offline > 240 minutes or when
 *      cached data is from a previous day.
 *   6. Shifts the screen layout by 1–2px every 10 minutes to prevent monitor
 *      image retention, and reloads the page once a day at 3:00 AM.
 */

(function (global) {
  "use strict";

  var STORAGE_KEYS = {
    API_DATA: "beaksquad_cached_api_data_v1",
    LAST_FETCH_MS: "beaksquad_last_good_fetch_ms_v1",
    CLOCK_OFFSET_MS: "beaksquad_clock_offset_ms_v1"
  };

  var CONFIG = global.BEAKSQUAD_CONFIG || {};

  // Application runtime state
  var state = {
    displayRole: "status",       // "info" | "status"
    apiData: null,               // Last good JSON payload from Code.gs
    lastGoodFetchMs: null,       // Timestamp (in corrected ms) of last successful fetch
    clockOffsetMs: 0,            // serverTimeMs - localTimeMs
    hasClockDrift: false,        // True when |clockOffsetMs| > 60s
    isOffline: false,            // True when the most recent fetch failed
    activeTheme: CONFIG.DEFAULT_THEME || "vaporwave",
    testNowOverride: null,       // String from ?now=YYYY-MM-DDTHH:MM
    testDayOverride: null,       // String from ?day=A or ?day=B
    testThemeOverride: null,     // String from ?theme=...
    bootChicagoDate: null,       // Used to prevent multiple 3:00 AM reloads on the same day
    lastReloadDate: null
  };

  /**
   * Reads URL query parameters (?display=, ?now=, ?day=, ?theme=).
   */
  function parseUrlParams() {
    var params = new URLSearchParams(global.location.search || "");

    var disp = (params.get("display") || "status").trim().toLowerCase();
    state.displayRole = disp === "info" ? "info" : "status";

    var nowParam = params.get("now");
    if (nowParam && nowParam.trim()) {
      state.testNowOverride = nowParam.trim();
    }

    var dayParam = params.get("day");
    if (dayParam && dayParam.trim()) {
      var d = dayParam.trim().toUpperCase();
      if (d === "A" || d === "B") {
        state.testDayOverride = d;
      }
    }

    var themeParam = params.get("theme");
    if (themeParam && themeParam.trim()) {
      state.testThemeOverride = themeParam.trim().toLowerCase();
    }
  }

  /**
   * Loads saved API data, fetch timestamp, and clock-drift offset from localStorage.
   */
  function loadFromStorage() {
    try {
      var savedData = global.localStorage.getItem(STORAGE_KEYS.API_DATA);
      if (savedData) {
        state.apiData = JSON.parse(savedData);
      }

      var savedFetchMs = global.localStorage.getItem(STORAGE_KEYS.LAST_FETCH_MS);
      if (savedFetchMs !== null) {
        var parsedFetch = Number(savedFetchMs);
        if (!isNaN(parsedFetch) && parsedFetch > 0) {
          state.lastGoodFetchMs = parsedFetch;
        }
      }

      var savedOffsetMs = global.localStorage.getItem(STORAGE_KEYS.CLOCK_OFFSET_MS);
      if (savedOffsetMs !== null) {
        var parsedOffset = Number(savedOffsetMs);
        if (!isNaN(parsedOffset)) {
          state.clockOffsetMs = parsedOffset;
          var thresholdMs = (CONFIG.CLOCK_DRIFT_THRESHOLD_SECONDS || 60) * 1000;
          state.hasClockDrift = Math.abs(parsedOffset) > thresholdMs;
        }
      }
    } catch (err) {
      console.warn("Could not read localStorage cache:", err);
    }
  }

  /**
   * Saves the latest good API payload, fetch timestamp, and clock offset to localStorage.
   */
  function saveToStorage(apiData, fetchMs, offsetMs) {
    try {
      global.localStorage.setItem(STORAGE_KEYS.API_DATA, JSON.stringify(apiData));
      global.localStorage.setItem(STORAGE_KEYS.LAST_FETCH_MS, String(fetchMs));
      global.localStorage.setItem(STORAGE_KEYS.CLOCK_OFFSET_MS, String(offsetMs));
    } catch (err) {
      console.warn("Could not write to localStorage cache:", err);
    }
  }

  /**
   * Returns the current time corrected by the saved clock-drift offset, OR the
   * ?now= testing override if present.
   */
  function getCorrectedNow() {
    if (state.testNowOverride) {
      return state.testNowOverride;
    }
    var thresholdMs = (CONFIG.CLOCK_DRIFT_THRESHOLD_SECONDS || 60) * 1000;
    var appliedOffset = Math.abs(state.clockOffsetMs) > thresholdMs ? state.clockOffsetMs : 0;
    return new Date(Date.now() + appliedOffset);
  }

  /**
   * Applies the active theme by updating `<link id="theme-stylesheet">` in index.html.
   * Adding a future holiday theme only requires adding `kiosk/themes/<name>.css`
   * and selecting `<name>` in the Google Sheet!
   */
  function applyTheme(themeName) {
    var cleanTheme = String(
      state.testThemeOverride || themeName || CONFIG.DEFAULT_THEME || "vaporwave"
    )
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");

    if (!cleanTheme) {
      cleanTheme = "vaporwave";
    }

    if (state.activeTheme === cleanTheme) {
      return;
    }

    var linkEl = document.getElementById("theme-stylesheet");
    if (linkEl) {
      linkEl.setAttribute("href", "themes/" + cleanTheme + ".css");
      state.activeTheme = cleanTheme;
    }
    document.documentElement.setAttribute("data-theme", cleanTheme);
  }

  /**
   * Polls the Google Apps Script JSON API.
   *
   * IMPORTANT CORS RULE:
   *   Must be a plain `fetch(API_URL)` GET request with NO custom headers!
   */
  function pollApi() {
    var apiUrl = CONFIG.API_URL || "";

    // If the student hasn't replaced the placeholder URL yet, mark offline cleanly
    if (!apiUrl || apiUrl.indexOf("REPLACE_WITH_YOUR_DEPLOYMENT_ID") !== -1) {
      state.isOffline = true;
      tick();
      return Promise.resolve();
    }

    var localBeforeFetchMs = Date.now();

    // Plain fetch(apiUrl) — no headers object, no Content-Type, no Authorization!
    return fetch(apiUrl)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || typeof data !== "object") {
          throw new Error("Invalid JSON payload from API");
        }

        var localNowMs = Date.now();
        var estimatedLocalMidpointMs = Math.round((localBeforeFetchMs + localNowMs) / 2);

        // Check serverTime for Raspberry Pi clock drift (> 60 seconds)
        var newOffsetMs = state.clockOffsetMs;
        if (data.serverTime) {
          var serverMs = Date.parse(data.serverTime);
          if (!isNaN(serverMs)) {
            newOffsetMs = serverMs - estimatedLocalMidpointMs;
          }
        }

        var thresholdMs = (CONFIG.CLOCK_DRIFT_THRESHOLD_SECONDS || 60) * 1000;
        state.clockOffsetMs = newOffsetMs;
        state.hasClockDrift = Math.abs(newOffsetMs) > thresholdMs;

        var correctedNowMs =
          localNowMs + (state.hasClockDrift ? state.clockOffsetMs : 0);

        // First successful fetch clears offline flags & banners automatically!
        state.apiData = data;
        state.lastGoodFetchMs = correctedNowMs;
        state.isOffline = false;

        saveToStorage(data, correctedNowMs, state.clockOffsetMs);

        if (data.theme) {
          applyTheme(data.theme);
        }

        tick();
      })
      .catch(function (err) {
        console.warn("API fetch failed (using cached data):", err);
        state.isOffline = true;
        tick();
      });
  }

  /**
   * Builds the effective API data object passed to `getStatus()` and the displays.
   * When a student tests with `?now=...&day=B`, we ensure the simulated date is
   * respected so the testing override works even without a live backend.
   */
  function getEffectiveApiData(chicagoParts) {
    var base = state.apiData || {
      date: chicagoParts.dateStr,
      closedAllDay: false,
      closedReason: null,
      dayType: state.testDayOverride || null,
      customMessage: "",
      theme: state.activeTheme,
      room: CONFIG.DEFAULT_ROOM,
      slides: CONFIG.DEFAULT_SLIDES,
      warnings: []
    };

    // If testing via ?day=A|B or ?now=..., synthesize matching date on a shallow copy
    if (state.testDayOverride || state.testNowOverride) {
      return {
        date: chicagoParts.dateStr,
        closedAllDay: Boolean(state.apiData && state.apiData.closedAllDay && !state.testDayOverride),
        closedReason: state.apiData ? state.apiData.closedReason : null,
        dayType: state.testDayOverride || (state.apiData && state.apiData.dayType) || null,
        customMessage: (state.apiData && state.apiData.customMessage) || "",
        theme: (state.apiData && state.apiData.theme) || state.activeTheme,
        room: (state.apiData && state.apiData.room) || CONFIG.DEFAULT_ROOM,
        slides:
          state.apiData && Array.isArray(state.apiData.slides) && state.apiData.slides.length > 0
            ? state.apiData.slides
            : CONFIG.DEFAULT_SLIDES,
        warnings: (state.apiData && state.apiData.warnings) || []
      };
    }

    return base;
  }

  /**
   * Updates the shared offline banner and corner status dots (offline dot & clock-drift dot).
   *
   * Rules from §5:
   *   - Fetch fails: keep using cached data + saved offset. Show a small "offline" dot.
   *   - Last good fetch is older than OFFLINE_WARNING_MINUTES (240 min): replace the
   *     dot with a full-width banner, "OFFLINE — TIMES MAY BE INACCURATE", in
   *     --status-closed with dark text.
   *   - Cached date isn't today: status rule 3 applies ("No Classes"), and the banner shows.
   *   - First successful fetch clears everything automatically.
   */
  function updateSharedIndicators(chicagoParts) {
    var bannerEl = document.getElementById("offline-banner");
    var offlineDotEl = document.getElementById("offline-dot");
    var driftDotEl = document.getElementById("drift-dot");

    var thresholdMs = (CONFIG.CLOCK_DRIFT_THRESHOLD_SECONDS || 60) * 1000;
    var correctedNowMs =
      Date.now() + (Math.abs(state.clockOffsetMs) > thresholdMs ? state.clockOffsetMs : 0);

    var warnMinutes = CONFIG.OFFLINE_WARNING_MINUTES || 240;
    var warnMs = warnMinutes * 60 * 1000;

    var fetchTooOld =
      state.isOffline &&
      state.lastGoodFetchMs !== null &&
      correctedNowMs - state.lastGoodFetchMs > warnMs;

    var cachedDateNotToday =
      Boolean(
        !state.testNowOverride &&
        !state.testDayOverride &&
        state.apiData &&
        state.apiData.date &&
        state.apiData.date !== chicagoParts.dateStr
      );

    var showBanner = Boolean(fetchTooOld || cachedDateNotToday);
    var showOfflineDot = Boolean(state.isOffline && !showBanner && !state.testDayOverride);

    if (bannerEl) {
      bannerEl.hidden = !showBanner;
    }

    if (offlineDotEl) {
      offlineDotEl.hidden = !showOfflineDot;
    }

    if (driftDotEl) {
      driftDotEl.hidden = !state.hasClockDrift;
      if (state.hasClockDrift) {
        var driftSec = Math.round(state.clockOffsetMs / 1000);
        driftDotEl.setAttribute(
          "title",
          "Clock drift corrected by " + (driftSec > 0 ? "+" : "") + driftSec + "s"
        );
      }
    }
  }

  /**
   * Checks whether it is 3:00 AM in America/Chicago and reloads the page once per day.
   */
  function checkDailyReload(chicagoParts) {
    if (state.testNowOverride) return; // Don't auto-reload during URL testing

    var reloadHour =
      typeof CONFIG.DAILY_RELOAD_HOUR === "number" ? CONFIG.DAILY_RELOAD_HOUR : 3;
    var reloadMin =
      typeof CONFIG.DAILY_RELOAD_MINUTE === "number" ? CONFIG.DAILY_RELOAD_MINUTE : 0;

    if (!state.bootChicagoDate) {
      state.bootChicagoDate = chicagoParts.dateStr;
    }

    // Only reload if the date has advanced since boot (so reloading at 3:00:00 doesn't
    // loop infinitely during the 3:00 minute!)
    if (
      chicagoParts.dateStr !== state.bootChicagoDate &&
      chicagoParts.hour === reloadHour &&
      chicagoParts.minute === reloadMin &&
      state.lastReloadDate !== chicagoParts.dateStr
    ) {
      state.lastReloadDate = chicagoParts.dateStr;
      global.location.reload();
    }
  }

  /**
   * Shifts the entire kiosk layout by 1–2px every 10 minutes to reduce image
   * retention on static LCD/OLED monitors.
   */
  function applyPixelShift() {
    var rootEl = document.getElementById("kiosk-root");
    if (!rootEl) return;

    var maxPx = CONFIG.PIXEL_SHIFT_MAX_PX || 2;
    var offsets = [-maxPx, -1, 0, 1, maxPx];
    var dx = offsets[Math.floor(Math.random() * offsets.length)];
    var dy = offsets[Math.floor(Math.random() * offsets.length)];
    rootEl.style.transform = "translate(" + dx + "px, " + dy + "px)";
  }

  /**
   * Runs every second to update the clock, schedule status, and active display.
   */
  function tick() {
    var now = getCorrectedNow();
    var chicagoParts = global.BeakSquadSchedule.getChicagoParts(
      now,
      CONFIG.TIMEZONE || "America/Chicago"
    );

    var effectiveApiData = getEffectiveApiData(chicagoParts);
    var effectiveDayType =
      state.testDayOverride !== null
        ? state.testDayOverride
        : state.apiData
        ? state.apiData.dayType
        : null;

    var status = global.getStatus(now, effectiveDayType, effectiveApiData, CONFIG);

    updateSharedIndicators(chicagoParts);
    checkDailyReload(chicagoParts);

    var displays = global.BeakSquadDisplays || {};
    var activeDisplay = displays[state.displayRole];
    if (activeDisplay && typeof activeDisplay.render === "function") {
      activeDisplay.render({
        now: now,
        chicago: chicagoParts,
        status: status,
        apiData: effectiveApiData,
        config: CONFIG,
        isOffline: state.isOffline,
        hasClockDrift: state.hasClockDrift
      });
    }
  }

  /**
   * Initializes the kiosk application on DOMContentLoaded.
   */
  function init() {
    parseUrlParams();
    loadFromStorage();

    // Set initial theme from cache or URL override
    applyTheme(state.apiData && state.apiData.theme ? state.apiData.theme : CONFIG.DEFAULT_THEME);

    // Mount the selected display module ("info" or "status")
    var mountEl = document.getElementById("display-mount");
    document.body.setAttribute("data-display", state.displayRole);

    var displays = global.BeakSquadDisplays || {};
    var activeDisplay = displays[state.displayRole];
    if (activeDisplay && typeof activeDisplay.mount === "function" && mountEl) {
      activeDisplay.mount(mountEl, CONFIG);
    }

    // Perform an immediate render from cached state, then start the 1-second clock loop
    tick();
    global.setInterval(tick, 1000);

    // Fetch live data from Google Apps Script immediately and every 60 seconds
    pollApi();
    var pollMs = (CONFIG.POLL_INTERVAL_SECONDS || 60) * 1000;
    global.setInterval(pollApi, pollMs);

    // Run pixel-shift every 10 minutes to prevent monitor image retention
    var shiftMs = (CONFIG.PIXEL_SHIFT_INTERVAL_MINUTES || 10) * 60 * 1000;
    global.setInterval(applyPixelShift, shiftMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
