/**
 * ============================================================================
 * BEAKSQUAD HALLWAY SIGNAGE — INFO BOARD (kiosk/displays/info.js)
 * ============================================================================
 *
 * What this file does:
 *   Renders the Info Board (`index.html?display=info`):
 *     1. Built-in HOME page (not a sheet row): shows theInfo_Image (eagle or
 *        teacher graphic) on the left third of the screen, plus the giant
 *        Room_Number and Room_Tagline.
 *     2. Slide deck from the Google Sheet ("Slides" tab):
 *          - `Info_Mode = "rotate"`: cycles through HOME -> active slides
 *            sorted by `Sort_Order`, 10 seconds each with a 400ms crossfade.
 *          - `Info_Mode = "pinned"`: holds the slide named in `Pinned_Slide_ID`
 *            (or falls back to HOME if that ID is missing or inactive — never
 *            shows a blank screen!).
 *     3. Top-right corner indicators:
 *          - Small OPEN / CLOSED status pill so passersby always know if we're open.
 *          - Tiny 📌 pin icon when `Info_Mode` is `"pinned"`.
 *     4. Backtick code parser: text inside `` `backticks` `` renders in
 *        `--font-code` (`Share Tech Mono`).
 *     5. Scannable QR codes (`22vh`, black-on-white) via `api.qrserver.com` with
 *        `encodeURIComponent(QR_Link)` and an automatic `onerror` text fallback
 *        if the school web filter blocks the QR image service.
 */

(function (global) {
  "use strict";

  global.BeakSquadDisplays = global.BeakSquadDisplays || {};

  var dom = {};
  var deckState = {
    deck: [],                  // Array of slide items (starting with HOME)
    deckSignature: "",         // JSON signature to detect Sheet updates without resetting mid-slide
    currentIndex: 0,           // Active index when rotating
    lastSwitchMs: 0,           // Timestamp when the current slide became active
    renderedSlideKey: ""       // Prevents redundant DOM rebuilds every second
  };

  var IMAGE_MAP = {
    eagle: "assets/eagle.svg",
    teacher: "assets/teacher.svg",
    none: ""
  };

  /**
   * Builds the initial DOM skeleton for the Info Board.
   */
  function mount(container, config) {
    var crossfadeMs = (config && config.SLIDE_CROSSFADE_MS) || 400;
    container.innerHTML = [
      '<div class="board info-board">',
      '  <!-- Top Corner Bar: Brand + Pin Indicator + Small OPEN/CLOSED Pill -->',
      '  <header class="info-header">',
      '    <div class="info-brand">',
      '      <span class="brand-title">BEAKSQUAD IT HELP DESK</span>',
      '      <span class="slide-dots" id="info-slide-dots" aria-hidden="true"></span>',
      '    </div>',
      '    <div class="info-corner-pills">',
      '      <span class="pin-indicator" id="info-pin-indicator" title="Slide Pinned" hidden>\uD83D\uDCCC</span>',
      '      <span class="corner-status-pill" id="info-status-pill" data-state="closed">CLOSED</span>',
      '    </div>',
      '  </header>',
      '',
      '  <!-- Crossfade Stage for HOME & Sheet Slides -->',
      '  <div class="info-stage" id="info-stage" style="--crossfade-ms: ' + crossfadeMs + 'ms;">',
      '    <div class="info-slide-layer is-visible" id="info-layer-a"></div>',
      '    <div class="info-slide-layer" id="info-layer-b"></div>',
      '  </div>',
      '</div>'
    ].join("\n");

    dom = {
      slideDots: document.getElementById("info-slide-dots"),
      pinIndicator: document.getElementById("info-pin-indicator"),
      statusPill: document.getElementById("info-status-pill"),
      stage: document.getElementById("info-stage"),
      layerA: document.getElementById("info-layer-a"),
      layerB: document.getElementById("info-layer-b"),
      activeLayer: "A"
    };

    deckState.lastSwitchMs = Date.now();
    deckState.renderedSlideKey = "";
  }

  /**
   * Constructs the ordered list of slides starting with the built-in HOME page,
   * followed by active Sheet slides sorted by Sort_Order.
   */
  function buildDeck(apiData, config) {
    var room = (apiData && apiData.room) || (config && config.DEFAULT_ROOM) || {};
    var homeSlide = {
      id: "HOME",
      isHome: true,
      roomNumber: String(room.number || "224").trim(),
      tagline: String(room.tagline || "Student IT Help Desk — Walk-ins welcome").trim(),
      imageKey: String(room.image || "eagle").trim().toLowerCase()
    };

    var rawSlides =
      apiData && Array.isArray(apiData.slides)
        ? apiData.slides
        : (config && config.DEFAULT_SLIDES) || [];

    var activeSlides = rawSlides
      .filter(function (s) {
        return s && s.id && s.isActive !== false;
      })
      .slice()
      .sort(function (a, b) {
        return (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999);
      });

    return [homeSlide].concat(activeSlides);
  }

  /**
   * Formats slide text:
   *   - Escapes raw HTML safely
   *   - Enforces the ~40-word slide limit and 6-line code limit
   *   - Converts text inside backticks (`...`) into `<code class="inline-code">...</code>`
   *     or `<pre class="code-block"><code>...</code></pre>` if multiline.
   */
  function formatSlideContent(rawText) {
    var trimmed = truncateWords(String(rawText || "").trim(), 45);
    var parts = trimmed.split(/(`[^`]+`)/g);

    return parts
      .map(function (segment) {
        if (segment.length >= 2 && segment.charAt(0) === "`" && segment.charAt(segment.length - 1) === "`") {
          var codeInner = segment.slice(1, -1);
          var lines = codeInner.split(/\r?\n/).slice(0, 6);
          var joinedCode = escapeHtml(lines.join("\n"));
          if (lines.length > 1) {
            return '<pre class="slide-code-block"><code>' + joinedCode + "</code></pre>";
          }
          return '<code class="slide-inline-code">' + joinedCode + "</code>";
        }
        return escapeHtml(segment).replace(/\r?\n/g, "<br />");
      })
      .join("");
  }

  /**
   * Keeps slide text concise (~40 words max) so it never overflows fixed monitors.
   */
  function truncateWords(text, maxWords) {
    var words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      return text;
    }
    return words.slice(0, maxWords).join(" ") + "\u2026";
  }

  /**
   * Shortens a URL for the text fallback if the QR API is blocked by the school filter.
   */
  function formatShortUrl(url) {
    return String(url || "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "");
  }

  /**
   * Renders the HTML for either the built-in HOME page or a Sheet slide.
   *
   * Color / Surface rules (§7):
   *   - HOME page: left third shows Info_Image, right two-thirds show giant
   *     Room_Number (--font-display, --accent-brand on dark page) and Room_Tagline
   *     inside Card A.
   *   - Regular slides ("announcement", "tip"): Card A (--card-a-bg)
   *   - Code / Command slides ("command"): Card B (--card-b-bg)
   */
  function buildSlideHtml(slide, status) {
    if (slide.isHome) {
      var imgSrc = IMAGE_MAP[slide.imageKey] || "";
      var hasImage = Boolean(imgSrc && slide.imageKey !== "none");

      var leftColHtml = hasImage
        ? [
            '<div class="home-visual-col">',
            '  <div class="home-graphic-frame">',
            '    <img class="home-graphic-img" src="' + escapeAttr(imgSrc) + '" alt="BeakSquad emblem" />',
            "  </div>",
            "</div>"
          ].join("\n")
        : "";

      var statusSubline = status.open
        ? "Currently OPEN \u00B7 " + (status.title || "Walk-ins welcome")
        : "Currently CLOSED \u00B7 " + (status.title || "");

      return [
        '<article class="home-layout ' + (hasImage ? "has-visual" : "no-visual") + '">',
        leftColHtml,
        '  <div class="home-info-col">',
        '    <div class="home-room-label">ROOM</div>',
        '    <h1 class="home-room-number">RM ' + escapeHtml(slide.roomNumber) + "</h1>",
        '    <div class="surface-card surface-card-a home-tagline-card">',
        '      <p class="home-tagline">' + escapeHtml(slide.tagline) + "</p>",
        '      <div class="home-substatus">' + escapeHtml(statusSubline) + "</div>",
        "    </div>",
        "  </div>",
        "</article>"
      ].join("\n");
    }

    // Sheet Slide: Card B for "command" slides, Card A for "announcement" / "tip"
    var isCommand = slide.type === "command";
    var cardClass = isCommand ? "surface-card-b" : "surface-card-a";
    var typeLabel =
      slide.type === "command"
        ? "TECH COMMAND"
        : slide.type === "tip"
        ? "QUICK TIP"
        : "ANNOUNCEMENT";

    var qrHtml = "";
    if (slide.qrLink) {
      // IMPORTANT (§3.6):
      //   - Always wrap QR_Link in encodeURIComponent() so & and ? don't break the query string.
      //   - Keep modules black on white at ~22vh for hallway scanning.
      //   - On error (e.g. school filter blocks api.qrserver.com), hide image and show URL text.
      var encodedUrl = encodeURIComponent(slide.qrLink);
      var qrApiSrc =
        "https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=12&data=" +
        encodedUrl;
      var shortUrl = formatShortUrl(slide.qrLink);

      qrHtml = [
        '<div class="slide-qr-col">',
        '  <div class="qr-box">',
        '    <img class="qr-image"',
        '         src="' + escapeAttr(qrApiSrc) + '"',
        '         alt="QR Code"',
        '         onerror="this.hidden=true; if(this.nextElementSibling){this.nextElementSibling.hidden=false;}" />',
        '    <div class="qr-fallback-text" hidden>',
        '      <span class="qr-fallback-label">VISIT LINK:</span>',
        '      <span class="qr-fallback-url">' + escapeHtml(shortUrl) + "</span>",
        "    </div>",
        "  </div>",
        '  <div class="qr-caption">SCAN WITH PHONE CAMERA</div>',
        "</div>"
      ].join("\n");
    }

    var footerHtml = slide.footer
      ? '<footer class="slide-footer">' + escapeHtml(slide.footer) + "</footer>"
      : "";

    var wordCount = String(slide.content || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    var sizeClass = wordCount > 28 ? "slide-content-compact" : "";

    return [
      '<article class="surface-card ' +
        cardClass +
        " sheet-slide-card " +
        (slide.qrLink ? "has-qr" : "no-qr") +
        '">',
      '  <div class="slide-main-col">',
      '    <div class="slide-type-pill">' + escapeHtml(typeLabel) + "</div>",
      '    <h1 class="slide-title">' + escapeHtml(slide.title) + "</h1>",
      '    <div class="slide-content ' + sizeClass + '">' +
        formatSlideContent(slide.content) +
        "</div>",
      footerHtml,
      "  </div>",
      qrHtml,
      "</article>"
    ].join("\n");
  }

  /**
   * Crossfades to the new slide HTML over 400ms (`SLIDE_CROSSFADE_MS`).
   */
  function transitionToSlideHtml(html) {
    if (!dom.layerA || !dom.layerB) return;

    // First render on boot: populate active layer immediately without crossfade
    if (!deckState.renderedSlideKey) {
      dom.layerA.innerHTML = html;
      dom.layerA.classList.add("is-visible");
      dom.layerB.classList.remove("is-visible");
      dom.activeLayer = "A";
      return;
    }

    var incoming = dom.activeLayer === "A" ? dom.layerB : dom.layerA;
    var outgoing = dom.activeLayer === "A" ? dom.layerA : dom.layerB;

    incoming.innerHTML = html;
    incoming.classList.add("is-visible");
    outgoing.classList.remove("is-visible");
    dom.activeLayer = dom.activeLayer === "A" ? "B" : "A";
  }

  /**
   * Updates the Info Board every second.
   */
  function render(ctx) {
    if (!dom.statusPill) return;

    var status = ctx.status;
    var apiData = ctx.apiData || {};
    var config = ctx.config || {};
    var room = apiData.room || config.DEFAULT_ROOM || {};

    // 1. Update corner OPEN / CLOSED pill
    var pillWord = status.open ? "OPEN" : "CLOSED";
    if (dom.statusPill.textContent !== pillWord) {
      dom.statusPill.textContent = pillWord;
    }
    dom.statusPill.setAttribute("data-state", status.open ? "open" : "closed");

    // 2. Build deck and check Info_Mode ("rotate" vs "pinned")
    var deck = buildDeck(apiData, config);
    var mode = String(room.mode || "rotate").trim().toLowerCase();
    var isPinned = mode === "pinned";
    var pinnedId = String(room.pinnedSlideId || "HOME").trim();

    // Show tiny 📌 icon in the corner while pinned
    dom.pinIndicator.hidden = !isPinned;

    // Select active slide
    var targetSlide = deck[0]; // Always fall back to HOME if anything is missing/inactive
    var activeIndex = 0;

    if (isPinned) {
      for (var i = 0; i < deck.length; i++) {
        if (String(deck[i].id).toUpperCase() === pinnedId.toUpperCase()) {
          targetSlide = deck[i];
          activeIndex = i;
          break;
        }
      }
    } else {
      var slideDurationMs = config.SLIDE_DURATION_MS || 10000;
      var nowMs = Date.now();
      if (deckState.currentIndex >= deck.length) {
        deckState.currentIndex = 0;
      }
      if (nowMs - deckState.lastSwitchMs >= slideDurationMs && deck.length > 1) {
        deckState.currentIndex = (deckState.currentIndex + 1) % deck.length;
        deckState.lastSwitchMs = nowMs;
      }
      activeIndex = deckState.currentIndex;
      targetSlide = deck[activeIndex] || deck[0];
    }

    // 3. Render progress dots in header (when rotating)
    if (isPinned || deck.length <= 1) {
      dom.slideDots.innerHTML = "";
    } else {
      dom.slideDots.innerHTML = deck
        .map(function (s, idx) {
          return (
            '<span class="slide-dot' +
            (idx === activeIndex ? " is-active" : "") +
            '"></span>'
          );
        })
        .join("");
    }

    // 4. Crossfade to target slide only when the slide or its content has changed
    var slideKey = JSON.stringify({
      slide: targetSlide,
      open: targetSlide.isHome ? status.open : undefined,
      title: targetSlide.isHome ? status.title : undefined
    });

    if (slideKey !== deckState.renderedSlideKey) {
      var html = buildSlideHtml(targetSlide, status);
      transitionToSlideHtml(html);
      deckState.renderedSlideKey = slideKey;
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  global.BeakSquadDisplays.info = {
    mount: mount,
    render: render
  };
})(typeof window !== "undefined" ? window : globalThis);
