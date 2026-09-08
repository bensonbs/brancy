/**
 * OpenTrancy YouTube Page Bridge (Runs in MAIN world)
 * Has direct access to window.ytInitialPlayerResponse and movie_player
 */

(function () {
  function getCaptionTracks() {
    try {
      // Method 1: Check movie_player.getPlayerResponse()
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        const resp = player.getPlayerResponse();
        const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          return { tracks, videoId: resp?.videoDetails?.videoId };
        }
      }

      // Method 2: Check window.ytInitialPlayerResponse
      if (window.ytInitialPlayerResponse) {
        const resp = window.ytInitialPlayerResponse;
        const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          return { tracks, videoId: resp?.videoDetails?.videoId };
        }
      }
    } catch (e) {
      console.warn("[OpenTrancy Page Bridge] Error reading player response:", e);
    }
    return null;
  }

  function broadcastCaptionTracks() {
    const data = getCaptionTracks();
    if (data && data.tracks) {
      window.postMessage({
        source: "OPEN_TRANCY_PAGE_BRIDGE",
        action: "CAPTION_TRACKS_FOUND",
        tracks: data.tracks,
        videoId: data.videoId
      }, "*");
    }
  }

  // Listen for requests from isolated content script
  window.addEventListener("message", (event) => {
    if (event.data && event.data.source === "OPEN_TRANCY_CONTENT_SCRIPT") {
      if (event.data.action === "REQUEST_CAPTION_TRACKS") {
        broadcastCaptionTracks();
      }
    }
  });

  // Check immediately and on navigation events
  broadcastCaptionTracks();
  window.addEventListener("yt-navigate-finish", () => {
    setTimeout(broadcastCaptionTracks, 800);
  });
})();
