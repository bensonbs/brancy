/**
 * Brancy YouTube Player Integration & Bilingual Subtitle Renderer
 */

(function () {
  if (window.BrancyYouTube) return;
  let BrancyUtils, BrancyCaptions;
  let settings = null;
  let cues = [];
  let currentCueIndex = -1;
  let videoEl = null;
  let subtitleContainer = null;
  let isSubtitleVisible = true;
  let lastVideoId = null;

  // Live caption observer variables
  let liveObserver = null;
  let liveCaption = null;
  let liveRevision = 0;
  let videoEvents = null;
  let observedPlayer = null;
  let liveTranslateTimer = null;

  async function init() {
    settings = await BrancyUtils.getSettings();
    isSubtitleVisible = settings.youtubeSubtitleEnabled;

    setupNavigationListener();
    setupVideoObserver();
    setupHotkeys();

    // Check if on a watch page right now
    checkAndLoadCaptions();
  }

  function setupNavigationListener() {
    window.addEventListener("yt-navigate-start", resetPlayback);
    window.addEventListener("yt-navigate-finish", checkAndLoadCaptions);

    window.addEventListener("brancy:cues-ready", (e) => {
      if (e.detail.videoId !== lastVideoId || e.detail.videoId !== getVideoId()) return;
      invalidateLiveCaption();
      cues = e.detail.cues || [];
      currentCueIndex = -1;
      if (videoEl) syncSubtitles(videoEl.currentTime, true);
    });

    // Listen for storage changes
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local" || !Object.keys(changes).some(key => key.startsWith("youtube") || key === "shortcutsEnabled")) return;
        settings = await BrancyUtils.getSettings();
        isSubtitleVisible = settings.youtubeSubtitleEnabled;
        applySubtitleStyles();
        if (!isSubtitleVisible) invalidateLiveCaption();
      });
    }
  }

  function getVideoId() {
    return new URLSearchParams(window.location.search).get("v");
  }

  function invalidateLiveCaption() {
    clearTimeout(liveTranslateTimer);
    liveRevision++;
    liveCaption = null;
  }

  function resetPlayback() {
    invalidateLiveCaption();
    cues = [];
    currentCueIndex = -1;
    lastVideoId = null;
    renderLines("", "");
  }

  function checkAndLoadCaptions() {
    const videoId = getVideoId();
    if (!videoId) {
      resetPlayback();
      removeSubtitleContainer();
      return;
    }
    ensureSubtitleContainer();
    injectPlayerControls();
    setupLiveCaptionObserver();
    if (videoId !== lastVideoId) {
      resetPlayback();
      lastVideoId = videoId;
      ensureNativeCcEnabled();
      Promise.resolve(BrancyCaptions.fetchCaptionsForCurrentVideo()).then(loaded => {
        if (videoId !== lastVideoId || videoId !== getVideoId() || cues.length || !loaded?.length) return;
        invalidateLiveCaption();
        cues = loaded;
        if (videoEl) syncSubtitles(videoEl.currentTime, true);
      }).catch(error => console.warn("[Brancy] Could not load caption track:", error));
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
      const player = document.getElementById("movie_player");
      const video = player?.querySelector("video.html5-main-video") || player?.querySelector("video") || null;
      if (video !== videoEl) {
        videoEvents?.abort();
        invalidateLiveCaption();
        renderLines("", "");
        videoEl = video;
        currentCueIndex = -1;
        if (videoEl) bindVideoEvents();
      }
      if (getVideoId()) checkAndLoadCaptions();
    };
    findVideo();
    const observer = new MutationObserver(BrancyUtils.debounce(findVideo, 100));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function bindVideoEvents() {
    const video = videoEl;
    videoEvents = new AbortController();
    const listen = (name, handler) => video.addEventListener(name, handler, { signal: videoEvents.signal });
    const sync = () => {
      if (video !== videoEl || getVideoId() !== lastVideoId) return;
      if (cues.length) syncSubtitles(video.currentTime);
      else readLiveCaption();
    };
    listen("timeupdate", sync);
    listen("play", sync);
    listen("pause", () => {
      clearTimeout(liveTranslateTimer);
      if (liveCaption && !liveCaption.requested) liveCaption = null;
      if (cues.length) syncSubtitles(video.currentTime);
    });
    listen("seeking", () => {
      invalidateLiveCaption();
      if (cues.length) syncSubtitles(video.currentTime);
      else renderLines("", "");
    });
    listen("seeked", () => {
      if (cues.length) syncSubtitles(video.currentTime);
      else readLiveCaption(true);
    });
    listen("emptied", () => { invalidateLiveCaption(); renderLines("", ""); });
    listen("ended", () => { invalidateLiveCaption(); renderLines("", ""); });
    sync();
  }

  function nativeCaptionText() {
    return BrancyUtils.stripMusicLabels(Array.from(observedPlayer?.querySelectorAll(".ytp-caption-segment") || [])
      .map(segment => segment.textContent || "").join(" "));
  }

  function setupLiveCaptionObserver() {
    const player = document.getElementById("movie_player");
    if (!player || (liveObserver && observedPlayer === player)) return;
    liveObserver?.disconnect();
    observedPlayer = player;
    liveObserver = new MutationObserver(() => readLiveCaption());
    liveObserver.observe(player, { childList: true, subtree: true, characterData: true });
  }

  function readLiveCaption(afterSeek = false) {
    if (cues.length || !videoEl || !isSubtitleVisible || !lastVideoId || getVideoId() !== lastVideoId) return;
    // Pausing freezes the current live caption. Late network responses and DOM
    // mutations cannot advance it. Seeking while paused may select a new caption.
    if (videoEl.seeking || (videoEl.paused && !afterSeek)) return;
    const text = nativeCaptionText();
    if (!text) {
      invalidateLiveCaption();
      renderLines("", "");
      return;
    }
    if (liveCaption?.text === text) {
      if (liveCaption.translation) renderLines(liveCaption.translation, text, liveCaption.stage, liveCaption.status);
      return;
    }
    invalidateLiveCaption();
    const snapshot = liveCaption = { text, video: videoEl, videoId: lastVideoId,
      revision: liveRevision, translation: "", requested: false };
    renderLines("", text);
    liveTranslateTimer = setTimeout(async () => {
      if (!isCurrentLiveCaption(snapshot)) return;
      snapshot.requested = true;
      try {
        await BrancyUtils.translateProgressively({ action: "TRANSLATE_TEXTS", texts: [text] }, {
          isCurrent: () => isCurrentLiveCaption(snapshot),
          onUpdate: response => {
            snapshot.translation = response?.success && typeof response.data?.[0] === "string" ? response.data[0] : "";
            snapshot.stage = response?.stages?.[0] || "google";
            snapshot.status = response?.statuses?.[0] || "";
            if (!videoEl.paused) renderLines(snapshot.translation, text, snapshot.stage, snapshot.status);
          }
        });
      } catch { /* Keep the original caption when translation is unavailable. */ }
    }, 80);
  }

  function isCurrentLiveCaption(snapshot) {
    return snapshot === liveCaption && snapshot.revision === liveRevision &&
      snapshot.video === videoEl && snapshot.videoId === getVideoId() &&
      snapshot.videoId === lastVideoId && !cues.length && !videoEl.seeking &&
      isSubtitleVisible && nativeCaptionText() === snapshot.text;
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
          <div class="ot-sub-stage"></div>
        </div>
      `;
      player.appendChild(subtitleContainer);
      applySubtitleStyles();
      if (videoEl && cues.length) syncSubtitles(videoEl.currentTime, true);
    }
  }

  function removeSubtitleContainer() {
    if (subtitleContainer) {
      subtitleContainer.parentElement?.classList.remove("brancy-captions-active");
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
    subtitleContainer.parentElement?.classList.toggle("brancy-captions-active", isSubtitleVisible);
  }

  function syncSubtitles(currentTime, force = false) {
    if (!cues || cues.length === 0) return;

    // In overlapping auto-caption windows, the most recently started cue wins.
    const index = cues.findLastIndex(c => currentTime >= c.start && currentTime < c.end);
    if (force || index !== currentCueIndex) {
      currentCueIndex = index;
      updateSubtitleDisplay();
    }
  }

  function updateSubtitleDisplay() {
    const cue = cues[currentCueIndex];
    renderLines(cue?.translation || "", cue?.text || "", cue?.translationStage, cue?.translationStatus);
  }

  function renderLines(translation, original, stage = "google", status = "") {
    if (!subtitleContainer) return;
    const box = subtitleContainer.querySelector(".ot-sub-box");
    const targetLine = subtitleContainer.querySelector(".ot-target-line");
    const originLine = subtitleContainer.querySelector(".ot-origin-line");
    const trans = BrancyUtils.stripMusicLabels(translation), orig = BrancyUtils.stripMusicLabels(original);
    const normalize = text => text.replace(/\s+/g, "").toLowerCase();
    const target = normalize(trans) !== normalize(orig) ? trans : "";
    // Avoid retriggering our observer for an unchanged subtitle.
    if (targetLine.textContent !== target) targetLine.textContent = target;
    if (originLine.textContent !== orig) originLine.textContent = orig;
    targetLine.style.display = target ? "" : "none";
    box.classList.toggle("visible", Boolean(orig));
    const label = subtitleContainer.querySelector(".ot-sub-stage");
    const stageText = target ? BrancyUtils.translationStageLabel(stage) + (status ? " · 補譯未完成" : "") : "";
    if (label.textContent !== stageText) label.textContent = stageText;
    label.title = status;
    label.style.display = stageText ? "" : "none";
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
    `;

    rightControls.insertBefore(controlsWrapper, rightControls.firstChild);

    controlsWrapper.querySelector("#ot-ytp-sub-toggle").addEventListener("click", () => {
      toggleSubtitles();
    });
  }

  function toggleSubtitles(force) {
    isSubtitleVisible = typeof force === "boolean" ? force : !isSubtitleVisible;
    if (subtitleContainer) {
      subtitleContainer.style.display = isSubtitleVisible ? "flex" : "none";
    }
    subtitleContainer?.parentElement?.classList.toggle("brancy-captions-active", isSubtitleVisible);
    invalidateLiveCaption();
    if (isSubtitleVisible) {
      if (cues.length && videoEl) syncSubtitles(videoEl.currentTime, true);
      else readLiveCaption();
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

  const controller = window.BrancyYouTube = { ready: null };
  function startWhenReady() {
    if (controller.ready || document.readyState === "loading" || !window.BrancyUtils || !window.BrancyCaptions) return;
    BrancyUtils = window.BrancyUtils;
    BrancyCaptions = window.BrancyCaptions;
    window.removeEventListener("brancy:utils-ready", startWhenReady);
    window.removeEventListener("brancy:captions-ready", startWhenReady);
    controller.ready = init().catch(error => {
      console.warn("[Brancy] YouTube initialization failed:", error);
    });
  }
  window.addEventListener("brancy:utils-ready", startWhenReady);
  window.addEventListener("brancy:captions-ready", startWhenReady);
  document.addEventListener("DOMContentLoaded", startWhenReady, { once: true });
  startWhenReady();
})();
