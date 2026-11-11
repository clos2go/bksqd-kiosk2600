/**
 * ============================================================================
 * BEAKSQUAD HALLWAY SIGNAGE — STATUS BOARD (kiosk/displays/status.js)
 * ============================================================================
 *
 * What this file does:
 *   Renders the Status Board (`index.html?display=status`):
 *     1. Header bar with Room title, A Day / B Day badge, and live clock.
 *     2. Giant "OPEN" or "CLOSED" word in the theme's display font (>= 18vh)
 *        directly on the dark background (--status-open / --status-closed).
 *     3. Hero reason panel (--hero-bg / --hero-border / --hero-text) showing
 *        the current period or closure reason ("B Lunch — Out to lunch. Literally.")
 *        plus the live countdown ("Opens at 1:30 PM · in 23 min" or "Closes in 12 min.").
 *     4. Today's Open Windows list inside Card A (--card-a-bg / --card-a-border /
 *        --card-a-text), dynamically generated from `config.js` via `status.todaysWindows`,
 *        with the current window highlighted and past windows dimmed.
 */

(function (global) {
  "use strict";

  global.BeakSquadDisplays = global.BeakSquadDisplays || {};

  var dom = {};
  var lastWindowsSignature = "";

  /**
   * Formats 24-hour parts (hour 0..23, minute 0..59) into 12-hour "H:MM AM/PM".
   */
  function formatLiveClock(hour24, minute) {
    var suffix = hour24 >= 12 ? "PM" : "AM";
    var h12 = hour24 % 12;
    if (h12 === 0) h12 = 12;
    var mm = minute < 10 ? "0" + minute : String(minute);
    return String(h12) + ":" + mm + " " + suffix;
  }

  /**
   * Builds the initial DOM skeleton for the Status Board once on boot.
   */
  function mount(container) {
    container.innerHTML = [
      '<div class="board status-board">',
      '  <!-- Top Bar: Brand + A/B Day Badge + Live Clock -->',
      '  <header class="status-header">',
      '    <div class="status-brand">',
      '      <span class="brand-badge" id="status-room-badge">RM 224</span>',
      '      <span class="brand-title">BEAKSQUAD HELP DESK</span>',
      '    </div>',
      '    <div class="status-clock-group">',
      '      <span class="day-badge" id="status-day-badge">NO CLASSES</span>',
      '      <time class="live-clock" id="status-live-clock">12:00 PM</time>',
      '    </div>',
      '  </header>',
      '',
      '  <!-- Main Two-Column Body: Left = Giant Status + Hero Panel, Right = Today\'s Open Windows -->',
      '  <div class="status-grid">',
      '    <section class="status-primary" aria-live="polite">',
      '      <div class="status-word-wrap">',
      '        <h1 class="status-word" id="status-word">CLOSED</h1>',
      '      </div>',
      '',
      '      <!-- Hero Card for Reason + Countdown -->',
      '      <div class="surface-card surface-hero status-reason-card" id="status-reason-card">',
      '        <div class="reason-line" id="status-reason-line">',
      '          <strong class="reason-title" id="status-reason-title">Checking Schedule</strong>',
      '          <span class="reason-sep" id="status-reason-sep"> — </span>',
      '          <span class="reason-message" id="status-reason-message">Loading...</span>',
      '        </div>',
      '        <div class="status-countdown" id="status-countdown"></div>',
      '      </div>',
      '    </section>',
      '',
      '    <!-- Card A for Today\'s Open Windows List -->',
      '    <aside class="surface-card surface-card-a status-windows-card">',
      '      <h2 class="windows-heading" id="status-windows-heading">TODAY\'S OPEN WINDOWS</h2>',
      '      <ul class="windows-list" id="status-windows-list"></ul>',
      '      <div class="windows-empty" id="status-windows-empty" hidden>',
      '        Help desk is closed all day today.',
      '      </div>',
      '    </aside>',
      '  </div>',
      '</div>'
    ].join("\n");

    dom = {
      roomBadge: document.getElementById("status-room-badge"),
      dayBadge: document.getElementById("status-day-badge"),
      liveClock: document.getElementById("status-live-clock"),
      statusWord: document.getElementById("status-word"),
      reasonTitle: document.getElementById("status-reason-title"),
      reasonSep: document.getElementById("status-reason-sep"),
      reasonMessage: document.getElementById("status-reason-message"),
      countdown: document.getElementById("status-countdown"),
      windowsHeading: document.getElementById("status-windows-heading"),
      windowsList: document.getElementById("status-windows-list"),
      windowsEmpty: document.getElementById("status-windows-empty")
    };
    lastWindowsSignature = "";
  }

  /**
   * Updates the Status Board every second with the latest status and clock.
   */
  function render(ctx) {
    if (!dom.statusWord) return;

    var status = ctx.status;
    var chicago = ctx.chicago;
    var apiData = ctx.apiData || {};
    var roomNum = (apiData.room && apiData.room.number) || "224";

    // 1. Room number & Live Clock
    dom.roomBadge.textContent = "RM " + roomNum;
    dom.liveClock.textContent = formatLiveClock(chicago.hour, chicago.minute);

    // 2. A Day / B Day badge
    if (status.dayType === "A" || status.dayType === "B") {
      dom.dayBadge.textContent = status.dayType + " DAY";
      dom.dayBadge.setAttribute("data-day-type", status.dayType);
    } else if (chicago.isWeekend) {
      dom.dayBadge.textContent = "WEEKEND";
      dom.dayBadge.setAttribute("data-day-type", "NONE");
    } else {
      dom.dayBadge.textContent = "NO CLASSES";
      dom.dayBadge.setAttribute("data-day-type", "NONE");
    }

    // 3. Giant OPEN / CLOSED word (always show the word itself, never color alone)
    var word = status.open ? "OPEN" : "CLOSED";
    if (dom.statusWord.textContent !== word) {
      dom.statusWord.textContent = word;
    }
    dom.statusWord.setAttribute("data-state", status.open ? "open" : "closed");

    // 4. Hero Reason Panel ("B Lunch — Out to lunch. Literally.")
    var titleText = status.title || "";
    var msgText = status.message || "";
    dom.reasonTitle.textContent = titleText;

    if (msgText && msgText !== titleText) {
      dom.reasonSep.hidden = false;
      dom.reasonMessage.hidden = false;
      dom.reasonMessage.textContent = msgText;
    } else {
      dom.reasonSep.hidden = true;
      dom.reasonMessage.hidden = true;
    }

    // 5. Countdown ("Opens at 1:30 PM · in 23 min" or "Closes in 12 min.")
    if (status.nextChangeAt) {
      var mins = status.nextChangeAt.minutesFromNow;
      if (status.open) {
        dom.countdown.textContent = "Closes in " + mins + " min.";
      } else {
        dom.countdown.textContent =
          "Opens at " + status.nextChangeAt.time12 + " \u00B7 in " + mins + " min";
      }
      dom.countdown.hidden = false;
    } else {
      dom.countdown.textContent = status.open ? "" : "Closed for the remainder of the day";
      dom.countdown.hidden = false;
    }

    // 6. Today's Open Windows List (dynamically generated from config.js)
    var windows = status.todaysWindows || [];
    var sig = JSON.stringify(
      windows.map(function (w) {
        return w.id + ":" + w.label + ":" + w.state;
      })
    );

    if (sig !== lastWindowsSignature) {
      lastWindowsSignature = sig;
      if (windows.length === 0) {
        dom.windowsList.hidden = true;
        dom.windowsList.innerHTML = "";
        dom.windowsEmpty.hidden = false;
      } else {
        dom.windowsEmpty.hidden = true;
        dom.windowsList.hidden = false;
        dom.windowsList.innerHTML = windows
          .map(function (win) {
            var stateBadge = "";
            if (win.isCurrent) {
              stateBadge = '<span class="win-pill win-pill-now">NOW</span>';
            } else if (win.isPast) {
              stateBadge = '<span class="win-pill win-pill-done">DONE</span>';
            }
            return [
              '<li class="window-item window-' + win.state + '">',
              '  <div class="window-meta">',
              '    <span class="window-period">' + escapeHtml(win.name) + "</span>",
              stateBadge,
              "  </div>",
              '  <div class="window-time">' + escapeHtml(win.label) + "</div>",
              "</li>"
            ].join("");
          })
          .join("");
      }
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  global.BeakSquadDisplays.status = {
    mount: mount,
    render: render
  };
})(typeof window !== "undefined" ? window : globalThis);
