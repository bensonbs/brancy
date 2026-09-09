/**
 * Brancy YouTube Page Bridge (Runs in MAIN world)
 * Direct access to YouTube player methods, ytInitialPlayerResponse, and network interception
 */

(function () {
  let hasHooked = false;

  function captionVideoId(url) {
    try { return new URL(url, location.href).searchParams.get("v") || new URLSearchParams(location.search).get("v"); }
    catch { return null; }
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
              window.postMessage({
                source: "BRANCY_PAGE_BRIDGE",
                action: "NATIVE_TIMEDTEXT_CAPTURED",
                rawText,
                videoId,
                url
              }, "*");
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
              window.postMessage({
                source: "BRANCY_PAGE_BRIDGE",
                action: "NATIVE_TIMEDTEXT_CAPTURED",
                rawText: this.responseText,
                videoId: this._brancyVideoId,
                url: this._brancyUrl
              }, "*");
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
            return { tracks, videoId: resp?.videoDetails?.videoId };
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
        if (typeof player.getOption === "function") {
          const tracklist = player.getOption("captions", "tracklist");
          if (tracklist && tracklist.length > 0) {
            const en = tracklist.find(t => t.languageCode === "en") || tracklist[0];
            player.setOption("captions", "track", en);
          }
        }
      }
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

  initHooks();
  broadcastCaptionTracks();

  window.addEventListener("yt-navigate-finish", () => {
    setTimeout(broadcastCaptionTracks, 600);
  });
})();
