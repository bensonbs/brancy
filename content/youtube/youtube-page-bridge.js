/**
 * Brancy YouTube Page Bridge (Runs in MAIN world)
 * Direct access to YouTube player methods, ytInitialPlayerResponse, and network interception
 */

(function () {
  let hasHooked = false;
  const nativeFetch = window.fetch.bind(window);
  const originalRequests = new Set();
  let recoveryTimer = null;
  let recoveryVideoId = null;
  let receivedTimedText = false;
  let restartedCc = false;

  function resetRecovery() {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    recoveryVideoId = new URLSearchParams(location.search).get("v");
    receivedTimedText = false;
    restartedCc = false;
    originalRequests.clear();
  }

  function noteTimedText(rawText, videoId) {
    if (videoId !== recoveryVideoId) return;
    try {
      const hasCues = rawText.trim().startsWith("{")
        ? JSON.parse(rawText).events?.some(event => event.segs?.some(seg => seg.utf8?.trim()))
        : /<(text|p)\b/.test(rawText);
      if (hasCues) {
        receivedTimedText = true;
        clearTimeout(recoveryTimer);
        recoveryTimer = null;
      }
    } catch { /* Empty/error responses must not disable recovery. */ }
  }

  function scheduleCaptionRecovery() {
    if (recoveryTimer || receivedTimedText) return;
    const videoId = recoveryVideoId;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (videoId !== new URLSearchParams(location.search).get("v") || receivedTimedText) return;
      const player = document.getElementById("movie_player");
      if (!player) return;
      if (player.querySelector?.(".ytp-caption-segment")?.textContent?.trim()) return;
      const video = player.querySelector?.("video");
      if (video?.paused || video?.seeking || video?.readyState < 2) {
        scheduleCaptionRecovery();
        return;
      }
      // YouTube can mark CC as enabled before its caption module is ready.
      // Reproduce the native off/on action once, without changing the language.
      const cc = player.querySelector?.(".ytp-subtitles-button");
      if (!restartedCc && cc?.getAttribute("aria-pressed") === "true") {
        restartedCc = true;
        cc.click();
        cc.click();
        console.log("[Brancy Page Bridge] Restarted stalled native captions");
        scheduleCaptionRecovery();
        return;
      }
      // Never change the user's CC track, even to another track in the same language.
      window.postMessage({ source: "BRANCY_PAGE_BRIDGE", action: "CAPTION_LOAD_FAILED", videoId }, "*");
    }, 4500);
  }

  function captionVideoId(url) {
    try { return new URL(url, location.href).searchParams.get("v") || new URLSearchParams(location.search).get("v"); }
    catch { return null; }
  }

  function hasCaptionText(rawText) {
    try {
      return rawText.trim().startsWith("{")
        ? JSON.parse(rawText).events?.some(event => event.segs?.some(seg => seg.utf8?.trim()))
        : /<(text|p)\b/.test(rawText);
    } catch { return false; }
  }

  async function relayCaptions(rawText, url, videoId) {
    if (videoId !== new URLSearchParams(location.search).get("v")) return;
    const data = getCaptionTracks();
    const captured = new URL(url, location.href);
    const language = captured.searchParams.get("lang");
    const publish = (text, lang) => {
      if (videoId !== new URLSearchParams(location.search).get("v")) return;
      noteTimedText(text, videoId);
      window.postMessage({ source: "BRANCY_PAGE_BRIDGE", action: "NATIVE_TIMEDTEXT_CAPTURED",
        rawText: text, videoId, languageCode: lang }, "*");
    };
    const manualOriginal = data?.tracks.find(track => track.original && track.kind !== "asr");
    const capturedIsPreferred = language === data?.originalLanguage && !captured.searchParams.has("tlang") &&
      (!manualOriginal || captured.searchParams.get("kind") !== "asr");
    if (!data?.originalLanguage || capturedIsPreferred) {
      publish(rawText, language);
      return;
    }
    // Fetch original captions separately, using the player's already-obtained
    // request context. Never call setOption or change the user's CC language.
    const key = videoId + ":" + data.originalLanguage;
    if (originalRequests.has(key)) return;
    originalRequests.add(key);
    window.postMessage({ source: "BRANCY_PAGE_BRIDGE", action: "CAPTION_SOURCE_PENDING", videoId }, "*");
    for (const track of data.tracks.filter(t => t.original).sort((a, b) => Number(a.kind === "asr") - Number(b.kind === "asr"))) {
      try {
        const source = new URL(track.baseUrl);
        if (source.origin !== location.origin || source.pathname !== "/api/timedtext") continue;
        source.searchParams.set("fmt", "json3");
        for (const parameter of ["pot", "potc", "c", "cver", "cplayer", "cplatform", "cos", "cosver"]) {
          if (captured.searchParams.has(parameter)) source.searchParams.set(parameter, captured.searchParams.get(parameter));
        }
        const response = await nativeFetch(source.href, { credentials: "include", signal: AbortSignal.timeout(8000) });
        const text = await response.text();
        if (response.ok && hasCaptionText(text)) {
          console.log("[Brancy Page Bridge] Loaded original captions without changing CC:", data.originalLanguage);
          publish(text, data.originalLanguage);
          return;
        }
      } catch { /* Try another source track without selecting it in the player. */ }
    }
    window.postMessage({ source: "BRANCY_PAGE_BRIDGE", action: "CAPTION_LOAD_FAILED", videoId }, "*");
  }

  function initHooks() {
    if (hasHooked) return;
    hasHooked = true;

    // 1. Hook window.fetch for timedtext requests
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      const videoId = captionVideoId(url);
      const response = await origFetch.apply(this, args);
      try {
        if (url && url.includes("/api/timedtext")) {
          const clone = response.clone();
          clone.text().then((rawText) => {
            if (rawText && rawText.trim().length > 0) {
              relayCaptions(rawText, url, videoId);
            }
          }).catch(() => {});
        }
      } catch (e) {}
      return response;
    };

    // 2. Hook XMLHttpRequest for timedtext requests
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._brancyUrl = typeof url === "string" ? url : "";
      this._brancyVideoId = captionVideoId(this._brancyUrl);
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (this._brancyUrl && this._brancyUrl.includes("/api/timedtext")) {
        this.addEventListener("load", () => {
          try {
            if (this.responseText && this.responseText.trim().length > 0) {
              relayCaptions(this.responseText, this._brancyUrl, this._brancyVideoId);
            }
          } catch (e) {}
        });
      }
      return origSend.apply(this, args);
    };
  }

  function getCaptionTracks() {
    try {
      const player = document.getElementById("movie_player");
      if (player) {
        // Method 1: Check player.getPlayerResponse()
        if (typeof player.getPlayerResponse === "function") {
          const resp = player.getPlayerResponse();
          const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (tracks && tracks.length > 0) {
            const renderer = resp.captions.playerCaptionsTracklistRenderer;
            const audio = renderer.audioTracks?.[renderer.defaultAudioTrackIndex || 0];
            const audioLanguage = audio?.audioTrackId?.replace(/\.\d+$/, "");
            const originalLanguage = tracks.find(t => t.languageCode === audioLanguage)?.languageCode ||
              (audioLanguage && tracks.find(t => t.languageCode?.split("-")[0] === audioLanguage.split("-")[0])?.languageCode) ||
              tracks.find(t => t.kind === "asr")?.languageCode || tracks[audio?.captionTrackIndices?.[0]]?.languageCode || tracks[0]?.languageCode;
            return { tracks: tracks.map(t => ({ ...t, original: t.languageCode === originalLanguage })),
              originalLanguage, videoId: resp?.videoDetails?.videoId };
          }
        }

        // Method 2: Check player.getOption("captions", "tracklist")
        if (typeof player.getOption === "function") {
          const tracklist = player.getOption("captions", "tracklist");
          if (tracklist && tracklist.length > 0) {
            const formatted = tracklist.map(t => ({
              languageCode: t.languageCode,
              name: { simpleText: t.name || t.displayName || t.languageName || t.languageCode },
              baseUrl: t.baseUrl || t.url || "",
              kind: t.kind || (t.is_default ? "" : "asr")
            }));
            return { tracks: formatted, videoId: new URLSearchParams(window.location.search).get("v") };
          }
        }
      }

      // Method 3: Check window.ytInitialPlayerResponse
      if (window.ytInitialPlayerResponse) {
        const resp = window.ytInitialPlayerResponse;
        const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          return { tracks, videoId: resp?.videoDetails?.videoId };
        }
      }
    } catch (e) {
      console.warn("[Brancy Page Bridge] Error reading tracks:", e);
    }
    return null;
  }

  function triggerPlayerCaptions() {
    try {
      const player = document.getElementById("movie_player");
      if (player) {
        if (typeof player.loadModule === "function") {
          player.loadModule("captions");
        }
      }
      scheduleCaptionRecovery();
    } catch (e) {}
  }

  function broadcastCaptionTracks() {
    const data = getCaptionTracks();
    if (data && data.tracks) {
      window.postMessage({
        source: "BRANCY_PAGE_BRIDGE",
        action: "CAPTION_TRACKS_FOUND",
        tracks: data.tracks,
        videoId: data.videoId
      }, "*");
    }
    triggerPlayerCaptions();
  }

  // Listen for requests from isolated content script
  window.addEventListener("message", (event) => {
    if (event.data && event.data.source === "BRANCY_CONTENT_SCRIPT") {
      if (event.data.action === "REQUEST_CAPTION_TRACKS") {
        broadcastCaptionTracks();
      } else if (event.data.action === "TRIGGER_PLAYER_CAPTIONS") {
        triggerPlayerCaptions();
      }
    }
  });

  resetRecovery();
  window.addEventListener("yt-navigate-start", resetRecovery);
  initHooks();
  broadcastCaptionTracks();

  window.addEventListener("yt-navigate-finish", () => {
    if (recoveryVideoId !== new URLSearchParams(location.search).get("v")) resetRecovery();
    setTimeout(broadcastCaptionTracks, 600);
  });
})();
