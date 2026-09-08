/**
 * Brancy YouTube Caption Fetcher & Sentence Segmenter
 */

class YouTubeCaptionManager {
  constructor() {
    this.currentVideoId = null;
    this.currentTracks = null;
    this.cues = [];
    this.isLoading = false;
    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener("message", (event) => {
      if (!event.data || event.data.source !== "BRANCY_PAGE_BRIDGE") return;

      if (event.data.action === "CAPTION_TRACKS_FOUND") {
        this.handleTracksFound(event.data.tracks, event.data.videoId);
      } else if (event.data.action === "NATIVE_TIMEDTEXT_CAPTURED") {
        this.handleNativeTimedText(event.data.rawText);
      }
    });
  }

  getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("v");
  }

  async handleNativeTimedText(rawText) {
    if (!rawText || this.cues.length > 0) return;

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
      await this.processAndTranslateCues(rawCues);
    }
  }

  async fetchCaptionsForCurrentVideo() {
    const videoId = this.getVideoId();
    if (!videoId) return null;

    if (this.currentVideoId === videoId && this.cues.length > 0) {
      return this.cues;
    }

    this.currentVideoId = videoId;
    this.cues = [];
    this.isLoading = true;

    // 1. Request tracks & trigger player
    window.postMessage({
      source: "BRANCY_CONTENT_SCRIPT",
      action: "REQUEST_CAPTION_TRACKS"
    }, "*");

    // 2. Wait up to 1.2s for bridge response
    let tracks = await this.waitForTracks(1200);

    // 3. Fallback: fetch page HTML if bridge didn't answer
    if (!tracks || tracks.length === 0) {
      tracks = await this.fallbackFetchTracksFromHtml(videoId);
    }

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
    let rawCues = [];

    if (Array.isArray(rawEvents) && rawEvents.length > 0) {
      rawCues = this.parseEventsToCues(rawEvents);
    } else if (typeof rawEvents === "string" && rawEvents.includes("<text")) {
      rawCues = this.parseXmlToCues(rawEvents);
    }

    if (rawCues.length > 0) {
      await this.processAndTranslateCues(rawCues);
    } else {
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

  async processAndTranslateCues(rawCues) {
    const videoId = this.getVideoId();
    const segmentedCues = this.mergeSentenceSegments(rawCues);

    window.dispatchEvent(new CustomEvent("brancy:translating-start", { detail: { videoId } }));

    try {
      const resp = await BrancyUtils.sendMessageToBackground({
        action: "TRANSLATE_SUBTITLES",
        cues: segmentedCues,
        videoId
      });

      if (resp && resp.success && resp.data) {
        this.cues = resp.data;
      } else {
        this.cues = segmentedCues;
      }
    } catch (err) {
      console.error("[Brancy] Translation failed, using original subtitles:", err);
      this.cues = segmentedCues;
    }

    this.isLoading = false;
    window.dispatchEvent(new CustomEvent("brancy:cues-ready", {
      detail: { cues: this.cues, videoId }
    }));
  }

  waitForTracks(timeoutMs) {
    return new Promise((resolve) => {
      if (this.currentTracks && this.currentTracks.length > 0) {
        resolve(this.currentTracks);
        return;
      }
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const listener = (event) => {
        if (event.data?.source === "BRANCY_PAGE_BRIDGE" && event.data?.action === "CAPTION_TRACKS_FOUND") {
          clearTimeout(timer);
          window.removeEventListener("message", listener);
          resolve(event.data.tracks);
        }
      };
      window.addEventListener("message", listener);
    });
  }

  handleTracksFound(tracks, videoId) {
    if (tracks && tracks.length > 0) {
      this.currentTracks = tracks;
    }
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
      const end = start + Math.max(0.5, duration);

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
          end: start + Math.max(0.5, dur),
          duration: dur,
          text,
          translation: ""
        });
      }
    }

    return cues;
  }

  /**
   * Intelligently merges short/fragmented cues into coherent sentences
   */
  mergeSentenceSegments(cues) {
    if (!cues || cues.length <= 1) return cues;

    const merged = [];
    let current = null;

    const sentenceEndRegex = /[.?!。！？]$/;

    for (const cue of cues) {
      if (!current) {
        current = { ...cue };
        continue;
      }

      const silenceGap = cue.start - current.end;
      const wordsCount = current.text.split(/\s+/).length;
      const hasTerminalPunctuation = sentenceEndRegex.test(current.text);

      if (!hasTerminalPunctuation && silenceGap < 1.5 && wordsCount < 18) {
        current.text = `${current.text} ${cue.text}`.trim();
        current.end = cue.end;
        current.duration = current.end - current.start;
      } else {
        merged.push(current);
        current = { ...cue };
      }
    }

    if (current) {
      merged.push(current);
    }

    return merged.map((c, i) => ({ ...c, id: i }));
  }
}

if (typeof window !== "undefined") {
  window.BrancyCaptions = new YouTubeCaptionManager();
}
