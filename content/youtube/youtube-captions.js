/**
 * Brancy YouTube Caption Fetcher & Sentence Segmenter
 */

class YouTubeCaptionManager {
  constructor() {
    this.currentVideoId = null;
    this.currentTracks = null;
    this.cues = [];
    this.isLoading = false;
    this.loadRevision = 0;
    this.translationRevision = 0;
    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data || event.data.source !== "BRANCY_PAGE_BRIDGE") return;

      if (event.data.action === "CAPTION_TRACKS_FOUND") {
        this.handleTracksFound(event.data.tracks, event.data.videoId);
      } else if (event.data.action === "NATIVE_TIMEDTEXT_CAPTURED") {
        this.handleNativeTimedText(event.data.rawText, event.data.videoId);
      }
    });
  }

  getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("v");
  }

  resetForVideo(videoId) {
    if (this.currentVideoId === videoId) return;
    this.currentVideoId = videoId;
    this.currentTracks = null;
    this.cues = [];
    this.isLoading = false;
    this.loadRevision++;
    this.translationRevision++;
  }

  isCurrent(videoId, revision) {
    return videoId === this.getVideoId() && videoId === this.currentVideoId && revision === this.loadRevision;
  }

  async handleNativeTimedText(rawText, videoId) {
    if (!rawText || !videoId || videoId !== this.getVideoId()) return;
    this.resetForVideo(videoId);
    if (this.cues.length > 0) return;

    let rawCues = [];
    // Try JSON3
    if (rawText.trim().startsWith("{")) {
      try {
        const data = JSON.parse(rawText);
        if (data && data.events) {
          rawCues = this.parseEventsToCues(data.events);
        }
      } catch (e) {}
    }

    // Try XML
    if (rawCues.length === 0 && rawText.includes("<text")) {
      rawCues = this.parseXmlToCues(rawText);
    }

    if (rawCues.length > 0) {
      console.log("[Brancy] Intercepted native timedtext:", rawCues.length, "cues");
      await this.processAndTranslateCues(rawCues, videoId, this.loadRevision);
    }
  }

  async fetchCaptionsForCurrentVideo() {
    const videoId = this.getVideoId();
    if (!videoId) return null;

    if (this.currentVideoId === videoId && (this.cues.length > 0 || this.isLoading)) {
      return this.cues;
    }

    this.resetForVideo(videoId);
    const revision = this.loadRevision;
    this.isLoading = true;

    // 1. Request tracks & trigger player
    window.postMessage({
      source: "BRANCY_CONTENT_SCRIPT",
      action: "REQUEST_CAPTION_TRACKS"
    }, "*");

    // 2. Wait up to 1.2s for bridge response
    let tracks = await this.waitForTracks(1200, videoId);

    if (!this.isCurrent(videoId, revision)) return null;

    // 3. Fallback: fetch page HTML if bridge didn't answer
    if (!tracks || tracks.length === 0) {
      tracks = await this.fallbackFetchTracksFromHtml(videoId);
    }

    if (!this.isCurrent(videoId, revision)) return null;
    if (this.cues.length) return this.cues;
    if (!tracks || tracks.length === 0) {
      console.warn("[Brancy] No caption tracks found for video:", videoId);
      this.isLoading = false;
      window.dispatchEvent(new CustomEvent("brancy:no-captions", { detail: { videoId } }));
      return null;
    }

    // 4. Select best track
    const selectedTrack = this.selectBestTrack(tracks);
    console.log("[Brancy] Selected caption track:", selectedTrack);

    // 5. Try fetching timedtext directly
    const rawEvents = await this.fetchTimedText(selectedTrack.baseUrl);
    if (!this.isCurrent(videoId, revision)) return null;
    if (this.cues.length) return this.cues;
    let rawCues = [];

    if (Array.isArray(rawEvents) && rawEvents.length > 0) {
      rawCues = this.parseEventsToCues(rawEvents);
    } else if (typeof rawEvents === "string" && rawEvents.includes("<text")) {
      rawCues = this.parseXmlToCues(rawEvents);
    }

    if (rawCues.length > 0) {
      await this.processAndTranslateCues(rawCues, videoId, revision);
    } else {
      this.isLoading = false;
      // Direct fetch was empty (poToken protected)
      // Request player to activate CC and listen for native network intercept / live DOM
      console.log("[Brancy] Direct timedtext was empty, activating player CC & Live DOM observer");
      window.postMessage({
        source: "BRANCY_CONTENT_SCRIPT",
        action: "TRIGGER_PLAYER_CAPTIONS"
      }, "*");
      window.dispatchEvent(new CustomEvent("brancy:enable-dom-observer", { detail: { videoId } }));
    }

    return this.cues;
  }

  async processAndTranslateCues(rawCues, videoId, revision) {
    if (!this.isCurrent(videoId, revision) || this.cues.length) return;
    const translationRevision = ++this.translationRevision;
    // Keep the source clock intact. Combining adjacent cues displays future words
    // early, and waiting for translation leaves the renderer on delayed live text.
    const sourceCues = rawCues.filter(cue => Number.isFinite(cue.start) && cue.end > cue.start)
      .sort((a, b) => a.start - b.start).map((cue, id) => ({ ...cue, id }));
    this.cues = sourceCues;
    const publish = () => window.dispatchEvent(new CustomEvent("brancy:cues-ready", {
      detail: { cues: this.cues, videoId }
    }));
    publish();
    window.dispatchEvent(new CustomEvent("brancy:translating-start", { detail: { videoId } }));
    try {
      const response = await BrancyUtils.sendMessageToBackground({
        action: "TRANSLATE_SUBTITLES", cues: sourceCues, videoId
      });
      if (!this.isCurrent(videoId, revision) || translationRevision !== this.translationRevision) return;
      if (response?.success && Array.isArray(response.data) && response.data.length === sourceCues.length) {
        // Only translations can be enriched asynchronously; timestamps and source
        // text always come from the current video's caption track.
        this.cues = sourceCues.map((cue, i) => ({ ...cue,
          translation: typeof response.data[i]?.translation === "string" ? response.data[i].translation : ""
        }));
      }
    } catch (error) {
      if (!this.isCurrent(videoId, revision) || translationRevision !== this.translationRevision) return;
      console.warn("[Brancy] Translation unavailable; keeping timed original captions:", error);
    }
    this.isLoading = false;
    publish();
  }

  waitForTracks(timeoutMs, videoId) {
    return new Promise(resolve => {
      if (this.currentVideoId === videoId && this.currentTracks?.length) {
        resolve(this.currentTracks);
        return;
      }
      const finish = tracks => {
        clearTimeout(timer);
        window.removeEventListener("message", listener);
        resolve(tracks);
      };
      const listener = event => {
        if (event.source === window && event.data?.source === "BRANCY_PAGE_BRIDGE" &&
            event.data.action === "CAPTION_TRACKS_FOUND" && event.data.videoId === videoId) {
          finish(event.data.tracks);
        }
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      window.addEventListener("message", listener);
    });
  }

  handleTracksFound(tracks, videoId) {
    if (videoId !== this.getVideoId() || !tracks?.length) return;
    this.resetForVideo(videoId);
    this.currentTracks = tracks;
  }

  async fallbackFetchTracksFromHtml(videoId) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      const html = await res.text();
      const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
      if (match && match[1]) {
        const data = JSON.parse(match[1]);
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          return tracks;
        }
      }
    } catch (e) {
      console.warn("[Brancy] Fallback HTML scrape failed:", e);
    }
    return null;
  }

  selectBestTrack(tracks) {
    // 1. Manual English or original track
    const manualEn = tracks.find(t => t.languageCode === "en" && t.kind !== "asr");
    if (manualEn) return manualEn;

    // 2. Auto-generated English
    const autoEn = tracks.find(t => t.languageCode === "en");
    if (autoEn) return autoEn;

    // 3. Any manual track
    const anyManual = tracks.find(t => t.kind !== "asr");
    if (anyManual) return anyManual;

    // 4. Default to first track
    return tracks[0];
  }

  async fetchTimedText(baseUrl) {
    const url = baseUrl.includes("fmt=json3") ? baseUrl : `${baseUrl}&fmt=json3`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 0) {
          if (text.trim().startsWith("{")) {
            try {
              const data = JSON.parse(text);
              return data.events || [];
            } catch (e) {}
          } else if (text.includes("<text")) {
            return text;
          }
        }
      }
    } catch (e) {}

    return [];
  }

  parseEventsToCues(events) {
    const cues = [];
    let id = 0;

    for (const ev of events) {
      if (!ev.segs || ev.segs.length === 0) continue;
      const text = ev.segs.map(s => s.utf8 || "").join("").replace(/\n/g, " ").trim();
      if (!text) continue;

      const start = (ev.tStartMs || 0) / 1000;
      const duration = (ev.dDurationMs || 0) / 1000;
      const end = start + (duration > 0 ? duration : 0.5);

      cues.push({
        id: id++,
        start,
        end,
        duration,
        text,
        translation: ""
      });
    }

    return cues;
  }

  parseXmlToCues(xmlString) {
    const cues = [];
    const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    let id = 0;

    while ((match = regex.exec(xmlString)) !== null) {
      const start = parseFloat(match[1]);
      const dur = parseFloat(match[2]);
      const raw = match[3];
      const text = raw
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\n/g, " ")
        .trim();

      if (text) {
        cues.push({
          id: id++,
          start,
          end: start + (dur > 0 ? dur : 0.5),
          duration: dur,
          text,
          translation: ""
        });
      }
    }

    return cues;
  }

}

if (typeof window !== "undefined") {
  window.BrancyCaptions = new YouTubeCaptionManager();
}
