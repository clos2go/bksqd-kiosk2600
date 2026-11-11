/**
 * ============================================================================
 * BEAKSQUAD HALLWAY SIGNAGE — SCHEDULE ENGINE (kiosk/schedule.js)
 * ============================================================================
 *
 * What this file does:
 *   Decides minute-by-minute whether the BeakSquad help desk is OPEN or CLOSED,
 *   why it is closed, when it next opens or closes, and what today's open
 *   windows are.
 *
 * Rules for this file:
 *   1. PURE LOGIC ONLY — No `document.*` or DOM access is allowed here so that
 *      `tests/schedule.test.html` can test every single rule in isolation.
 *   2. ALWAYS AMERICA/CHICAGO — We convert `now` to `America/Chicago` using the
 *      built-in `Intl.DateTimeFormat` API. Never rely on the Raspberry Pi's
 *      system timezone setting.
 */

(function (global) {
  "use strict";

  var DEFAULT_TIMEZONE = "America/Chicago";

  /**
   * Converts a "HH:MM" 24-hour string (e.g. "13:30") into minutes since midnight (810).
   *
   * @param {string} hhmm - Time string in "HH:MM" format.
   * @return {number} Minutes since 00:00.
   */
  function parseTimeToMinutes(hhmm) {
    var parts = String(hhmm || "00:00").split(":");
    var hours = parseInt(parts[0], 10) || 0;
    var mins = parseInt(parts[1], 10) || 0;
    return hours * 60 + mins;
  }

  /**
   * Formats minutes since midnight (e.g. 810) back into 24-hour "HH:MM" ("13:30").
   *
   * @param {number} totalMinutes - Minutes since 00:00.
   * @return {string} 24-hour time string.
   */
  function formatMinutes24(totalMinutes) {
    var h = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    return (h < 10 ? "0" + h : String(h)) + ":" + (m < 10 ? "0" + m : String(m));
  }

  /**
   * Formats minutes since midnight into 12-hour time without AM/PM (e.g. "9:05" or "1:30").
   * Used for compact window labels like "9:05–10:20" and "1:30–2:45".
   *
   * @param {number} totalMinutes - Minutes since 00:00.
   * @return {string} 12-hour time string without suffix.
   */
  function formatMinutes12Short(totalMinutes) {
    var h24 = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return String(h12) + ":" + (m < 10 ? "0" + m : String(m));
  }

  /**
   * Formats minutes since midnight into 12-hour time with AM/PM (e.g. "1:30 PM").
   *
   * @param {number} totalMinutes - Minutes since 00:00.
   * @return {string} 12-hour time string with AM/PM.
   */
  function formatMinutes12AmPm(totalMinutes) {
    var h24 = Math.floor(totalMinutes / 60);
    var suffix = h24 >= 12 ? "PM" : "AM";
    return formatMinutes12Short(totalMinutes) + " " + suffix;
  }

  /**
   * Extracts calendar date and wall-clock time parts in America/Chicago (or the
   * configured timezone).
   *
   * Also supports bare ISO strings like "2026-11-12T11:20" (from URL ?now=...
   * overrides or unit tests) as direct America/Chicago wall-clock times so test
   * results never depend on the developer's computer timezone.
   *
   * @param {Date|string|number} nowInput - Current time or test override.
   * @param {string} timeZone             - IANA timezone (default "America/Chicago").
   * @return {Object} { dateStr, year, month, day, weekday, hour, minute, second, minuteOfDay, dateObj }
   */
  function getChicagoParts(nowInput, timeZone) {
    var tz = timeZone || DEFAULT_TIMEZONE;

    // If a bare local ISO string like "2026-11-12T11:20" is passed without a
    // timezone offset, treat its fields directly as America/Chicago wall-clock time.
    if (typeof nowInput === "string") {
      var bareIsoMatch = nowInput.match(
        /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/
      );
      if (bareIsoMatch) {
        var y = parseInt(bareIsoMatch[1], 10);
        var mo = parseInt(bareIsoMatch[2], 10);
        var d = parseInt(bareIsoMatch[3], 10);
        var hr = parseInt(bareIsoMatch[4], 10);
        var mi = parseInt(bareIsoMatch[5], 10);
        var sc = parseInt(bareIsoMatch[6] || "0", 10);
        var utcNoon = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
        var wkdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        var wkday = wkdays[utcNoon.getUTCDay()];
        var dateStrDirect =
          bareIsoMatch[1] + "-" + bareIsoMatch[2] + "-" + bareIsoMatch[3];
        var approxDate = constructChicagoDate(y, mo, d, hr, mi, sc, tz);
        return {
          dateStr: dateStrDirect,
          year: y,
          month: mo,
          day: d,
          weekday: wkday,
           isWeekend: wkday === "Sat" || wkday === "Sun",
          hour: hr,
          minute: mi,
          second: sc,
          minuteOfDay: hr * 60 + mi,
          dateObj: approxDate
        };
      }
    }

    var dateObj = nowInput instanceof Date ? nowInput : new Date(nowInput);
    if (isNaN(dateObj.getTime())) {
      dateObj = new Date();
    }

    var formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

    var parts = formatter.formatToParts(dateObj);
    var map = {};
    for (var i = 0; i < parts.length; i++) {
      map[parts[i].type] = parts[i].value;
    }

    var year = parseInt(map.year, 10);
    var month = parseInt(map.month, 10);
    var day = parseInt(map.day, 10);
    // Some engines format midnight (00:xx) as "24" when hour12 is false
    var hour = parseInt(map.hour, 10) % 24;
    var minute = parseInt(map.minute, 10);
    var second = parseInt(map.second, 10);
    var weekday = map.weekday; // "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
    var dateStr =
      String(year) +
      "-" +
      (month < 10 ? "0" + month : String(month)) +
      "-" +
      (day < 10 ? "0" + day : String(day));

    return {
      dateStr: dateStr,
      year: year,
      month: month,
      day: day,
      weekday: weekday,
      isWeekend: weekday === "Sat" || weekday === "Sun",
      hour: hour,
      minute: minute,
      second: second,
      minuteOfDay: hour * 60 + minute,
      dateObj: dateObj
    };
  }

  /**
   * Builds a real JS Date object corresponding to a specific wall-clock time
   * in America/Chicago (correctly handling CDT -05:00 vs CST -06:00).
   */
  function constructChicagoDate(year, month, day, hour, minute, second, timeZone) {
    var tz = timeZone || DEFAULT_TIMEZONE;
    // Start with an initial guess assuming UTC-6 (CST)
    var guessMs = Date.UTC(year, month - 1, day, hour + 6, minute, second || 0);
    var guessDate = new Date(guessMs);

    var formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

    var parts = formatter.formatToParts(guessDate);
    var map = {};
    for (var i = 0; i < parts.length; i++) {
      map[parts[i].type] = parts[i].value;
    }
    var gotHour = parseInt(map.hour, 10) % 24;
    var gotMin = parseInt(map.minute, 10);
    var diffMinutes = (hour * 60 + minute) - (gotHour * 60 + gotMin);
    if (diffMinutes > 720) diffMinutes -= 1440;
    if (diffMinutes < -720) diffMinutes += 1440;

    return new Date(guessMs + diffMinutes * 60000);
  }

  /**
   * Returns the display name of a schedule block for the given dayType ("A" or "B").
   */
  function resolveBlockName(block, dayType) {
    if (!block || !block.name) return "";
    if (typeof block.name === "string") return block.name;
    return block.name[dayType] || block.name.A || "";
  }

  /**
   * Evaluates Rules 4–9 for a single minute of an active school day ("A" or "B").
   *
   * Order of checks (first match wins):
   *   Rule 4: Before school start (including the 15-min pre-school buffer) → Before School
   *   Rule 5: After 16:20 (the end-of-day buffer, and anything later) → After School
   *   Rule 6: Inside a block with shopOpen: false, or closedOnDays includes today → block's name & closedMessage (checked in array order)
   *   Rule 7: In a transition buffer → Shift Change (except inside a noBuffer: true block)
   *   Rule 8: Gaps between blocks that no rule covers → Shift Change
   *   Rule 9: Otherwise → Open
   *
   * @param {number} minuteOfDay - Minutes since midnight (0..1439).
   * @param {string} dayType     - "A" or "B".
   * @param {Object} config      - BEAKSQUAD_CONFIG object.
   * @return {Object} { open, title, message, blockId, blockName, rule }
   */
  function evaluateSchoolMinute(minuteOfDay, dayType, config) {
    var schedule = (config && config.SCHEDULE) || [];
    var reasons = (config && config.REASONS) || {};
    var bufferMinutes =
      config && typeof config.BUFFER_MINUTES === "number" ? config.BUFFER_MINUTES : 15;
    var overrides = (config && config.TRANSITION_OVERRIDES) || {};

    // Parse all blocks with numeric startMin / endMin
    var parsedBlocks = [];
    var schoolStartMin = Infinity;
    var schoolEndMin = -Infinity;
    var schoolEndClock = "16:35";

    for (var i = 0; i < schedule.length; i++) {
      var b = schedule[i];
      var sMin = parseTimeToMinutes(b.start);
      var eMin = parseTimeToMinutes(b.end);
      if (sMin < schoolStartMin) schoolStartMin = sMin;
      if (eMin > schoolEndMin) {
        schoolEndMin = eMin;
        schoolEndClock = b.end;
      }
      parsedBlocks.push({
        raw: b,
        id: b.id,
        name: resolveBlockName(b, dayType),
        startStr: b.start,
        endStr: b.end,
        startMin: sMin,
        endMin: eMin,
        shopOpen: b.shopOpen !== false,
        noBuffer: Boolean(b.noBuffer),
        closedOnDays: Array.isArray(b.closedOnDays) ? b.closedOnDays : [],
        closedMessage: b.closedMessage || ""
      });
    }

    // Rule 4: Before school start, including the 15-minute pre-school buffer → Before School
    if (minuteOfDay < schoolStartMin) {
      return {
        open: false,
        title: (reasons.beforeSchool && reasons.beforeSchool.title) || "Before School",
        message: (reasons.beforeSchool && reasons.beforeSchool.message) || "Booting up...",
        blockId: null,
        blockName: null,
        rule: "beforeSchool"
      };
    }

    // Rule 5: After 16:20 (the end-of-day buffer, and anything later) → After School
    var endDayBuffer =
      overrides[schoolEndClock] !== undefined ? overrides[schoolEndClock] : bufferMinutes;
    var afterSchoolStartMin = schoolEndMin - endDayBuffer;
    if (minuteOfDay >= afterSchoolStartMin) {
      return {
        open: false,
        title: (reasons.afterSchool && reasons.afterSchool.title) || "After School",
        message: (reasons.afterSchool && reasons.afterSchool.message) || "Go home. Seriously.",
        blockId: null,
        blockName: null,
        rule: "afterSchool"
      };
    }

    // Rule 6: Inside a block with shopOpen: false, or whose closedOnDays includes today.
    //         Checked in array order so on B Day 11:10–11:45 shows "A Lunch" and
    //         11:45–12:50 shows "6th Period".
    for (var j = 0; j < parsedBlocks.length; j++) {
      var blk = parsedBlocks[j];
      if (minuteOfDay >= blk.startMin && minuteOfDay < blk.endMin) {
        var closedToday = !blk.shopOpen || blk.closedOnDays.indexOf(dayType) !== -1;
        if (closedToday) {
          return {
            open: false,
            title: blk.name,
            message: blk.closedMessage,
            blockId: blk.id,
            blockName: blk.name,
            rule: "closedBlock"
          };
        }
      }
    }

    // Rule 7: In a transition buffer → Shift Change.
    //         Exception: a block with noBuffer: true is open for its entire duration.
    //         Its own edges get no buffer, and other blocks' buffers can't cut into it.
    var insideNoBufferBlock = null;
    for (var k = 0; k < parsedBlocks.length; k++) {
      var nb = parsedBlocks[k];
      var nbOpenToday = nb.shopOpen && nb.closedOnDays.indexOf(dayType) === -1;
      if (nb.noBuffer && nbOpenToday && minuteOfDay >= nb.startMin && minuteOfDay < nb.endMin) {
        insideNoBufferBlock = nb;
        break;
      }
    }

    if (!insideNoBufferBlock) {
      // Collect unique transition times (start & end of every block without noBuffer: true)
      var transitionMap = {};
      for (var t = 0; t < parsedBlocks.length; t++) {
        var tb = parsedBlocks[t];
        if (tb.noBuffer) continue;
        transitionMap[tb.startStr] = tb.startMin;
        transitionMap[tb.endStr] = tb.endMin;
      }

      var transitionTimes = Object.keys(transitionMap);
      for (var u = 0; u < transitionTimes.length; u++) {
        var clockStr = transitionTimes[u];
        var transMin = transitionMap[clockStr];
        var bufLen =
          overrides[clockStr] !== undefined ? overrides[clockStr] : bufferMinutes;
        if (minuteOfDay >= transMin - bufLen && minuteOfDay < transMin) {
          return {
            open: false,
            title: (reasons.shiftChange && reasons.shiftChange.title) || "Shift Change",
            message:
              (reasons.shiftChange && reasons.shiftChange.message) ||
              "Swapping techs. Back in a few.",
            blockId: null,
            blockName: null,
            rule: "shiftChange"
          };
        }
      }
    }

    // Rule 8: Gaps between blocks that no rule covers → Shift Change
    var activeOpenBlock = insideNoBufferBlock;
    if (!activeOpenBlock) {
      for (var m = 0; m < parsedBlocks.length; m++) {
        var ob = parsedBlocks[m];
        var isOpenToday = ob.shopOpen && ob.closedOnDays.indexOf(dayType) === -1;
        if (isOpenToday && minuteOfDay >= ob.startMin && minuteOfDay < ob.endMin) {
          activeOpenBlock = ob;
          break;
        }
      }
    }

    if (!activeOpenBlock) {
      return {
        open: false,
        title: (reasons.shiftChange && reasons.shiftChange.title) || "Shift Change",
        message:
          (reasons.shiftChange && reasons.shiftChange.message) ||
          "Swapping techs. Back in a few.",
        blockId: null,
        blockName: null,
        rule: "gap"
      };
    }

    // Rule 9: Otherwise → Open!
    return {
      open: true,
      title: activeOpenBlock.name,
      message:
        (config && config.OPEN_STATUS_MESSAGE) ||
        "Walk-ins welcome — bring your Chromebook & charger.",
      blockId: activeOpenBlock.id,
      blockName: activeOpenBlock.name,
      rule: "open"
    };
  }

  /**
   * Dynamically builds the list of today's open windows from config.js for the
   * given dayType ("A" or "B"), marking each window as "past", "current", or "upcoming".
   *
   * Never hardcodes any times!
   *
   * @param {string} dayType            - "A" or "B".
   * @param {number} currentMinuteOfDay - Current minutes since midnight (0..1439).
   * @param {Object} config             - BEAKSQUAD_CONFIG object.
   * @return {Array<Object>} Array of window objects.
   */
  // Cache raw daily window intervals by dayType so 1,440-minute test sweeps run in <10ms
  var rawWindowCache = {};

  function buildTodaysWindows(dayType, currentMinuteOfDay, config) {
    if (dayType !== "A" && dayType !== "B") {
      return [];
    }

    var cacheKey =
      dayType +
      "|" +
      (config && config.BUFFER_MINUTES) +
      "|" +
      JSON.stringify((config && config.TRANSITION_OVERRIDES) || {}) +
      "|" +
      ((config && config.SCHEDULE && config.SCHEDULE.length) || 0);

    var rawWindows = rawWindowCache[cacheKey];
    if (!rawWindows) {
      rawWindows = [];
      var currentWin = null;

      for (var m = 0; m < 1440; m++) {
        var res = evaluateSchoolMinute(m, dayType, config);
        if (res.open) {
          if (!currentWin || currentWin.id !== res.blockId) {
            if (currentWin) {
              rawWindows.push(currentWin);
            }
            currentWin = {
              id: res.blockId,
              name: res.blockName,
              startMinutes: m,
              endMinutes: m + 1
            };
          } else {
            currentWin.endMinutes = m + 1;
          }
        } else if (currentWin) {
          rawWindows.push(currentWin);
          currentWin = null;
        }
      }

      if (currentWin) {
        rawWindows.push(currentWin);
      }
      rawWindowCache[cacheKey] = rawWindows;
    }

    var windows = [];
    for (var i = 0; i < rawWindows.length; i++) {
      windows.push(finalizeWindow(rawWindows[i], currentMinuteOfDay));
    }
    return windows;
  }

  /**
   * Formats a raw window range with 24h, 12h, human-readable labels, and state.
   */
  function finalizeWindow(win, currentMinuteOfDay) {
    var start24 = formatMinutes24(win.startMinutes);
    var end24 = formatMinutes24(win.endMinutes);
    var start12 = formatMinutes12Short(win.startMinutes);
    var end12 = formatMinutes12Short(win.endMinutes);
    var startAmPm = formatMinutes12AmPm(win.startMinutes);
    var endAmPm = formatMinutes12AmPm(win.endMinutes);

    var isCurrent =
      typeof currentMinuteOfDay === "number" &&
      currentMinuteOfDay >= win.startMinutes &&
      currentMinuteOfDay < win.endMinutes;
    var isPast =
      typeof currentMinuteOfDay === "number" && currentMinuteOfDay >= win.endMinutes;
    var state = isCurrent ? "current" : isPast ? "past" : "upcoming";

    return {
      id: win.id,
      name: win.name,
      start: start24,
      end: end24,
      start12: start12,
      end12: end12,
      startFormatted: startAmPm,
      endFormatted: endAmPm,
      label: start12 + "–" + end12,
      labelAmPm: startAmPm + " – " + endAmPm,
      startMinutes: win.startMinutes,
      endMinutes: win.endMinutes,
      state: state,
      isCurrent: isCurrent,
      isPast: isPast
    };
  }

  /**
   * Main pure schedule function required by the specification:
   *   getStatus(now, dayType, apiData, config)
   *
   * Returns:
   *   {
   *     open: boolean,
   *     title: string,
   *     message: string,
   *     nextChangeAt: Date | null,   // Also carries .time12, .time24, .minutesFromNow
   *     todaysWindows: Array<Object>
   *   }
   *
   * @param {Date|string|number} now     - Current timestamp/Date (or ?now= override).
   * @param {string|null}        dayType - "A", "B", or null/undefined.
   * @param {Object|null}        apiData - Latest API payload (optional/nullable).
   * @param {Object}             config  - Configuration object (defaults to window.BEAKSQUAD_CONFIG).
   * @return {Object} Status result.
   */
  function getStatus(now, dayType, apiData, config) {
    var cfg = config || (typeof global !== "undefined" && global.BEAKSQUAD_CONFIG) || {};
    var reasons = cfg.REASONS || {};
    var tz = cfg.TIMEZONE || DEFAULT_TIMEZONE;
    var chicago = getChicagoParts(now, tz);

    // Resolve effective dayType: explicit parameter takes precedence, otherwise apiData.dayType
    var effectiveDay =
      dayType !== undefined ? dayType : apiData && apiData.dayType ? apiData.dayType : null;
    if (typeof effectiveDay === "string") {
      effectiveDay = effectiveDay.trim().toUpperCase();
      if (effectiveDay === "A DAY") effectiveDay = "A";
      if (effectiveDay === "B DAY") effectiveDay = "B";
      if (effectiveDay !== "A" && effectiveDay !== "B") {
        effectiveDay = null;
      }
    } else {
      effectiveDay = null;
    }

    // ------------------------------------------------------------------------
    // RULE 1: Saturday or Sunday (by the America/Chicago date) → Weekend
    // ------------------------------------------------------------------------
    if (chicago.isWeekend) {
      return {
        open: false,
        title: (reasons.weekend && reasons.weekend.title) || "Weekend",
        message:
          (reasons.weekend && reasons.weekend.message) ||
          "Even techs need to recharge. See you Monday.",
        nextChangeAt: null,
        todaysWindows: [],
        dayType: effectiveDay,
        rule: "weekend",
        chicago: chicago
      };
    }

    // ------------------------------------------------------------------------
    // RULE 2: closedAllDay → the API's reason or Custom_Closed_Message
    // ------------------------------------------------------------------------
    // Note: Only apply apiData's closedAllDay if apiData is not stale from a previous day.
    var hasStaleApiDate =
      Boolean(apiData && apiData.date && String(apiData.date).trim() !== chicago.dateStr);

    if (!hasStaleApiDate && apiData && apiData.closedAllDay) {
      var reasonTitle =
        (apiData.closedReason && String(apiData.closedReason).trim()) ||
        (apiData.customMessage && String(apiData.customMessage).trim()) ||
        (reasons.noClasses && reasons.noClasses.title) ||
        "Closed Today";
      var reasonMsg =
        (apiData.customMessage && String(apiData.customMessage).trim()) ||
        (apiData.closedReason && String(apiData.closedReason).trim()) ||
        (reasons.noClasses && reasons.noClasses.message) ||
        "No school today. Enjoy it.";

      return {
        open: false,
        title: reasonTitle,
        message: reasonMsg,
        nextChangeAt: null,
        todaysWindows: [],
        dayType: effectiveDay,
        rule: "closedAllDay",
        chicago: chicago
      };
    }

    // ------------------------------------------------------------------------
    // RULE 3: dayType is null/undefined, or the cached API date isn't today → No Classes
    // ------------------------------------------------------------------------
    if (hasStaleApiDate || !effectiveDay) {
      return {
        open: false,
        title: (reasons.noClasses && reasons.noClasses.title) || "No Classes",
        message:
          (reasons.noClasses && reasons.noClasses.message) || "No school today. Enjoy it.",
        nextChangeAt: null,
        todaysWindows: [],
        dayType: null,
        rule: "noClasses",
        chicago: chicago
      };
    }

    // ------------------------------------------------------------------------
    // RULES 4–9: Evaluate bell schedule & build today's open windows
    // ------------------------------------------------------------------------
    var minuteResult = evaluateSchoolMinute(chicago.minuteOfDay, effectiveDay, cfg);
    var todaysWindows = buildTodaysWindows(effectiveDay, chicago.minuteOfDay, cfg);

    // Calculate nextChangeAt (when the shop next closes if currently open,
    // or when it next opens today if currently closed)
    var nextTargetMinutes = null;
    if (minuteResult.open) {
      for (var i = 0; i < todaysWindows.length; i++) {
        if (todaysWindows[i].isCurrent) {
          nextTargetMinutes = todaysWindows[i].endMinutes;
          break;
        }
      }
    } else {
      for (var j = 0; j < todaysWindows.length; j++) {
        if (todaysWindows[j].startMinutes > chicago.minuteOfDay) {
          nextTargetMinutes = todaysWindows[j].startMinutes;
          break;
        }
      }
    }

    var nextChangeAt = null;
    var countdownText = "";
    if (nextTargetMinutes !== null) {
      var targetHour = Math.floor(nextTargetMinutes / 60);
      var targetMin = nextTargetMinutes % 60;
      nextChangeAt = constructChicagoDate(
        chicago.year,
        chicago.month,
        chicago.day,
        targetHour,
        targetMin,
        0,
        tz
      );
      var minsDiff = nextTargetMinutes - chicago.minuteOfDay;
      var time12 = formatMinutes12AmPm(nextTargetMinutes);
      var time24 = formatMinutes24(nextTargetMinutes);

      // Attach convenient metadata directly onto the Date instance
      nextChangeAt.time12 = time12;
      nextChangeAt.time24 = time24;
      nextChangeAt.minutesFromNow = minsDiff;
      nextChangeAt.totalMinutes = nextTargetMinutes;

      if (minuteResult.open) {
        countdownText = "Closes in " + minsDiff + " min";
      } else {
        countdownText = "Opens at " + time12 + " · in " + minsDiff + " min";
      }
    }

    return {
      open: minuteResult.open,
      title: minuteResult.title,
      message: minuteResult.message,
      nextChangeAt: nextChangeAt,
      countdownText: countdownText,
      todaysWindows: todaysWindows,
      dayType: effectiveDay,
      currentBlockId: minuteResult.blockId,
      currentBlockName: minuteResult.blockName,
      rule: minuteResult.rule,
      chicago: chicago
    };
  }

  // Expose pure functions globally for browser scripts and test suite
  global.getStatus = getStatus;
  global.BeakSquadSchedule = {
    getStatus: getStatus,
    buildTodaysWindows: buildTodaysWindows,
    evaluateSchoolMinute: evaluateSchoolMinute,
    getChicagoParts: getChicagoParts,
    parseTimeToMinutes: parseTimeToMinutes,
    formatMinutes24: formatMinutes24,
    formatMinutes12Short: formatMinutes12Short,
    formatMinutes12AmPm: formatMinutes12AmPm
  };
})(typeof window !== "undefined" ? window : globalThis);
