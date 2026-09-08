/**
 * Brancy YouTube Player Integration & Bilingual Subtitle Renderer
 */

(function () {
  let settings = null;
  let cues = [];
  let currentCueIndex = -1;
  let videoEl = null;
  let subtitleContainer = null;
  let isSubtitleVisible = true;
  let lastVideoId = null;

  // Live caption observer variables
  let liveObserver = null;
  let lastLiveText = "";
  let liveTranslateTimer = null;

  async function init() {
    settings = await BrancyUtils.getSettings();
    isSubtitleVisible = settings.youtubeSubtitleEnabled;

    setupVideoObserver();
    setupHotkeys();
    setupNavigationListener();
    setupLiveCaptionObserver();

    // Check if on a watch page right now
    checkAndLoadCaptions();
  }

  function setupNavigationListener() {
    window.addEventListener("yt-navigate-finish", () => {
      setTimeout(checkAndLoadCaptions, 800);
    });

    window.addEventListener("brancy:cues-ready", (e) => {
      cues = e.detail.cues || [];
      currentCueIndex = -1;
      updateSubtitleDisplay();
    });

    // Listen for storage changes
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(async () => {
        settings = await BrancyUtils.getSettings();
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
      lastLiveText = "";
      ensureSubtitleContainer();
      injectPlayerControls();
      ensureNativeCcEnabled();

      BrancyCaptions.fetchCaptionsForCurrentVideo();
    }
  }

  function ensureNativeCcEnabled() {
    const ccBtn = document.querySelector(".ytp-subtitles-button");
    if (ccBtn && ccBtn.getAttribute("aria-pressed") !== "true") {
      ccBtn.click();
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
    const observer = new MutationObserver(BrancyUtils.debounce(findVideo, 500));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function bindVideoEvents() {
    if (!videoEl) return;

    videoEl.addEventListener("timeupdate", () => {
      const time = videoEl.currentTime;
      syncSubtitles(time);
      if (window.BrancySidebar) {
        window.BrancySidebar.updateActiveTime(time);
      }
    });

    videoEl.addEventListener("seeking", () => {
      const time = videoEl.currentTime;
      syncSubtitles(time);
      if (window.BrancySidebar) {
        window.BrancySidebar.updateActiveTime(time);
      }
    });
  }

  /**
   * Live DOM Caption Observer:
   * Captures on-screen caption segments in real time from .ytp-caption-segment.
   * Guarantees bilingual subtitles even if network timedtext fetch was blocked!
   */
  function setupLiveCaptionObserver() {
    if (liveObserver) return;

    const observeCaptions = () => {
      const player = document.getElementById("movie_player") || document.body;
      liveObserver = new MutationObserver(() => {
        // If full pre-fetched cues are already loaded and working, prefer them
        if (cues && cues.length > 0) return;

        const segments = document.querySelectorAll(".ytp-caption-segment");
        if (!segments || segments.length === 0) {
          if (subtitleContainer && !cues.length) {
            subtitleContainer.querySelector(".ot-sub-box")?.classList.remove("visible");
          }
          return;
        }

        const fullText = Array.from(segments)
          .map(s => s.textContent || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (!fullText || fullText === lastLiveText) return;
        lastLiveText = fullText;

        clearTimeout(liveTranslateTimer);
        liveTranslateTimer = setTimeout(async () => {
          const currentText = fullText;
          try {
            const res = await BrancyUtils.sendMessageToBackground({
              action: "TRANSLATE_TEXTS",
              texts: [currentText]
            });
            const trans = res?.success && res?.data?.[0] ? res.data[0] : "";

            // Display on bilingual overlay
            if (subtitleContainer && isSubtitleVisible) {
              const targetLine = subtitleContainer.querySelector(".ot-target-line");
              const originLine = subtitleContainer.querySelector(".ot-origin-line");
              const box = subtitleContainer.querySelector(".ot-sub-box");
              if (targetLine && originLine && box) {
                const cleanOrig = currentText.replace(/[\s\uFEFF\xA0]+/g, "").toLowerCase();
                const cleanTrans = (trans || "").replace(/[\s\uFEFF\xA0]+/g, "").toLowerCase();

                if (cleanTrans && cleanTrans !== cleanOrig) {
                  targetLine.textContent = trans;
                  targetLine.style.display = "";
                } else {
                  targetLine.textContent = "";
                  targetLine.style.display = "none";
                }
                originLine.textContent = currentText;
                box.classList.add("visible");
              }
            }

            // Append to sidebar in real time
            if (window.BrancySidebar && videoEl) {
              window.BrancySidebar.appendLiveCue({
                start: Math.max(0, videoEl.currentTime - 1),
                end: videoEl.currentTime + 3,
                text: currentText,
                translation: trans
              });
            }
          } catch (e) {}
        }, 80);
      });

      liveObserver.observe(player, { childList: true, subtree: true, characterData: true });
    };

    observeCaptions();
  }

  function ensureSubtitleContainer() {
    const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
    if (!player) return;

    if (!subtitleContainer || !player.contains(subtitleContainer)) {
      if (subtitleContainer) subtitleContainer.remove();

      subtitleContainer = document.createElement("div");
      subtitleContainer.id = "brancy-subtitles";
      subtitleContainer.className = "brancy-subtitles";
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

    if (box) {
      box.classList.toggle("ot-origin-first", settings.youtubePrimaryOrder === "origin_first");
    }

    subtitleContainer.style.display = isSubtitleVisible ? "flex" : "none";
  }

  function syncSubtitles(currentTime) {
    if (!cues || cues.length === 0) return;

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
    const trans = cue.translation ? cue.translation.trim() : "";
    const orig = cue.text ? cue.text.trim() : "";

    const cleanOrig = orig.replace(/[\s\uFEFF\xA0]+/g, "").toLowerCase();
    const cleanTrans = trans.replace(/[\s\uFEFF\xA0]+/g, "").toLowerCase();

    if (cleanTrans && cleanTrans !== cleanOrig) {
      targetLine.textContent = trans;
      targetLine.style.display = "";
    } else {
      targetLine.textContent = "";
      targetLine.style.display = "none";
    }

    originLine.textContent = orig;
    box.classList.add("visible");
  }

  /**
   * Injects Brancy buttons into YouTube's player controls bar
   */
  function injectPlayerControls() {
    const rightControls = document.querySelector(".ytp-right-controls");
    if (!rightControls || document.getElementById("brancy-ytp-controls")) return;

    const controlsWrapper = document.createElement("div");
    controlsWrapper.id = "brancy-ytp-controls";
    controlsWrapper.className = "brancy-ytp-controls";
    controlsWrapper.innerHTML = `
      <button class="ytp-button ot-ytp-btn ${isSubtitleVisible ? "active" : ""}" id="ot-ytp-sub-toggle" title="Brancy 雙語字幕 (熱鍵 E)">
        <span class="ot-ytp-badge">雙</span>
      </button>
      <button class="ytp-button ot-ytp-btn" id="ot-ytp-sidebar-toggle" title="開啟 Brancy 腳本側邊欄 (熱鍵 R)">
        <span class="ot-ytp-badge">側</span>
      </button>
    `;

    rightControls.insertBefore(controlsWrapper, rightControls.firstChild);

    controlsWrapper.querySelector("#ot-ytp-sub-toggle").addEventListener("click", () => {
      toggleSubtitles();
    });

    controlsWrapper.querySelector("#ot-ytp-sidebar-toggle").addEventListener("click", () => {
      if (window.BrancySidebar) {
        window.BrancySidebar.toggle();
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

  function setupHotkeys() {
    document.addEventListener("keydown", (e) => {
      if (!settings?.shortcutsEnabled) return;

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
        if (window.BrancySidebar) {
          window.BrancySidebar.toggle();
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
