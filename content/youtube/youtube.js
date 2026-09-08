/**
 * OpenTrancy YouTube Player Integration & Bilingual Subtitle Renderer
 */

(function () {
  let settings = null;
  let cues = [];
  let currentCueIndex = -1;
  let videoEl = null;
  let subtitleContainer = null;
  let isSubtitleVisible = true;
  let lastVideoId = null;

  async function init() {
    settings = await OpenTrancyUtils.getSettings();
    isSubtitleVisible = settings.youtubeSubtitleEnabled;

    setupVideoObserver();
    setupHotkeys();
    setupNavigationListener();

    // Check if on a watch page right now
    checkAndLoadCaptions();
  }

  function setupNavigationListener() {
    window.addEventListener("yt-navigate-finish", () => {
      setTimeout(checkAndLoadCaptions, 1000);
    });

    window.addEventListener("open-trancy:cues-ready", (e) => {
      cues = e.detail.cues || [];
      currentCueIndex = -1;
      updateSubtitleDisplay();
    });

    // Listen for storage changes
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(async () => {
        settings = await OpenTrancyUtils.getSettings();
        isSubtitleVisible = settings.youtubeSubtitleEnabled;
        applySubtitleStyles();
      });
    }
  }

  function checkAndLoadCaptions() {
    const params = new URLSearchParams(window.location.search);
    const videoId = params.get("v");
    if (!videoId) {
      removeSubtitleContainer();
      return;
    }

    if (videoId !== lastVideoId) {
      lastVideoId = videoId;
      cues = [];
      currentCueIndex = -1;
      ensureSubtitleContainer();
      injectPlayerControls();
      OpenTrancyCaptions.fetchCaptionsForCurrentVideo();
    }
  }

  function setupVideoObserver() {
    const findVideo = () => {
      const v = document.querySelector("video");
      if (v && v !== videoEl) {
        videoEl = v;
        bindVideoEvents();
      }
    };

    findVideo();
    const observer = new MutationObserver(OpenTrancyUtils.debounce(findVideo, 500));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function bindVideoEvents() {
    if (!videoEl) return;

    videoEl.addEventListener("timeupdate", () => {
      const time = videoEl.currentTime;
      syncSubtitles(time);
      if (window.OpenTrancySidebar) {
        window.OpenTrancySidebar.updateActiveTime(time);
      }
    });

    videoEl.addEventListener("seeking", () => {
      const time = videoEl.currentTime;
      syncSubtitles(time);
      if (window.OpenTrancySidebar) {
        window.OpenTrancySidebar.updateActiveTime(time);
      }
    });
  }

  function ensureSubtitleContainer() {
    const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
    if (!player) return;

    if (!subtitleContainer || !player.contains(subtitleContainer)) {
      if (subtitleContainer) subtitleContainer.remove();

      subtitleContainer = document.createElement("div");
      subtitleContainer.id = "open-trancy-subtitles";
      subtitleContainer.className = "open-trancy-subtitles";
      subtitleContainer.innerHTML = `
        <div class="ot-sub-box">
          <div class="ot-sub-line ot-target-line"></div>
          <div class="ot-sub-line ot-origin-line"></div>
        </div>
      `;
      player.appendChild(subtitleContainer);
      applySubtitleStyles();
    }
  }

  function removeSubtitleContainer() {
    if (subtitleContainer) {
      subtitleContainer.remove();
      subtitleContainer = null;
    }
  }

  function applySubtitleStyles() {
    if (!subtitleContainer || !settings) return;

    const box = subtitleContainer.querySelector(".ot-sub-box");
    const targetLine = subtitleContainer.querySelector(".ot-target-line");
    const originLine = subtitleContainer.querySelector(".ot-origin-line");

    if (box) {
      box.style.backgroundColor = settings.youtubeSubBg || "rgba(0, 0, 0, 0.75)";
    }
    if (targetLine) {
      targetLine.style.fontSize = `${settings.youtubeFontSize || 20}px`;
      targetLine.style.color = settings.youtubeSubColor || "#ffffff";
    }
    if (originLine) {
      originLine.style.fontSize = `${settings.youtubeOriginFontSize || 14}px`;
    }

    // Order (target on top vs origin on top)
    if (box) {
      box.classList.toggle("ot-origin-first", settings.youtubePrimaryOrder === "origin_first");
    }

    subtitleContainer.style.display = isSubtitleVisible ? "flex" : "none";
  }

  function syncSubtitles(currentTime) {
    if (!cues || cues.length === 0) return;

    // Find cue
    const index = cues.findIndex(c => currentTime >= c.start && currentTime <= c.end);
    if (index !== currentCueIndex) {
      currentCueIndex = index;
      updateSubtitleDisplay();
    }
  }

  function updateSubtitleDisplay() {
    if (!subtitleContainer) return;

    const targetLine = subtitleContainer.querySelector(".ot-target-line");
    const originLine = subtitleContainer.querySelector(".ot-origin-line");
    const box = subtitleContainer.querySelector(".ot-sub-box");

    if (currentCueIndex === -1 || !cues[currentCueIndex]) {
      box.classList.remove("visible");
      return;
    }

    const cue = cues[currentCueIndex];
    targetLine.textContent = cue.translation || cue.text;
    originLine.textContent = cue.text;
    box.classList.add("visible");
  }

  /**
   * Injects OpenTrancy buttons into YouTube's player controls bar
   */
  function injectPlayerControls() {
    const rightControls = document.querySelector(".ytp-right-controls");
    if (!rightControls || document.getElementById("open-trancy-ytp-controls")) return;

    const controlsWrapper = document.createElement("div");
    controlsWrapper.id = "open-trancy-ytp-controls";
    controlsWrapper.className = "open-trancy-ytp-controls";
    controlsWrapper.innerHTML = `
      <button class="ytp-button ot-ytp-btn ${isSubtitleVisible ? "active" : ""}" id="ot-ytp-sub-toggle" title="OpenTrancy 雙語字幕 (熱鍵 E)">
        <span class="ot-ytp-badge">雙</span>
      </button>
      <button class="ytp-button ot-ytp-btn" id="ot-ytp-sidebar-toggle" title="開啟 OpenTrancy 腳本側邊欄 (熱鍵 R)">
        <span class="ot-ytp-badge">側</span>
      </button>
    `;

    // Insert before the settings or fullscreen button
    rightControls.insertBefore(controlsWrapper, rightControls.firstChild);

    // Subtitle toggle
    controlsWrapper.querySelector("#ot-ytp-sub-toggle").addEventListener("click", () => {
      toggleSubtitles();
    });

    // Sidebar toggle
    controlsWrapper.querySelector("#ot-ytp-sidebar-toggle").addEventListener("click", () => {
      if (window.OpenTrancySidebar) {
        window.OpenTrancySidebar.toggle();
      }
    });
  }

  function toggleSubtitles(force) {
    isSubtitleVisible = typeof force === "boolean" ? force : !isSubtitleVisible;
    if (subtitleContainer) {
      subtitleContainer.style.display = isSubtitleVisible ? "flex" : "none";
    }
    const btn = document.getElementById("ot-ytp-sub-toggle");
    if (btn) btn.classList.toggle("active", isSubtitleVisible);
  }

  /**
   * Keyboard shortcuts:
   * A: Previous sentence
   * S: Repeat current sentence
   * D: Next sentence
   * E: Toggle dual subtitles
   * R: Toggle sidebar
   */
  function setupHotkeys() {
    document.addEventListener("keydown", (e) => {
      if (!settings?.shortcutsEnabled) return;

      // Ignore when user is typing in inputs or textareas
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) {
        return;
      }

      const key = e.key.toUpperCase();

      if (key === "A") {
        e.preventDefault();
        seekSentenceOffset(-1);
      } else if (key === "S") {
        e.preventDefault();
        replayCurrentSentence();
      } else if (key === "D") {
        e.preventDefault();
        seekSentenceOffset(1);
      } else if (key === "E") {
        e.preventDefault();
        toggleSubtitles();
      } else if (key === "R") {
        e.preventDefault();
        if (window.OpenTrancySidebar) {
          window.OpenTrancySidebar.toggle();
        }
      }
    });
  }

  function seekSentenceOffset(offset) {
    if (!cues || cues.length === 0 || !videoEl) return;
    const nextIdx = Math.max(0, Math.min(cues.length - 1, currentCueIndex + offset));
    videoEl.currentTime = cues[nextIdx].start;
    videoEl.play();
  }

  function replayCurrentSentence() {
    if (!cues || cues.length === 0 || !videoEl) return;
    if (currentCueIndex >= 0 && cues[currentCueIndex]) {
      videoEl.currentTime = cues[currentCueIndex].start;
      videoEl.play();
    }
  }

  // Initialize
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
