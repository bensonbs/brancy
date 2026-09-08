/**
 * OpenTrancy YouTube Caption Fetcher & Sentence Segmenter
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
      if (event.data && event.data.source === "OPEN_TRANCY_PAGE_BRIDGE") {
        if (event.data.action === "CAPTION_TRACKS_FOUND") {
          this.handleTracksFound(event.data.tracks, event.data.videoId);
        }
      }
    });
  }

  getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("v");
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

    // 1. Request tracks from page bridge
    window.postMessage({
      source: "OPEN_TRANCY_CONTENT_SCRIPT",
      action: "REQUEST_CAPTION_TRACKS"
    }, "*");

    // 2. Wait up to 1.5s for bridge response
    let tracks = await this.waitForTracks(1500);

    // 3. Fallback: fetch page HTML if bridge didn't answer
    if (!tracks || tracks.length === 0) {
      tracks = await this.fallbackFetchTracksFromHtml(videoId);
    }

    if (!tracks || tracks.length === 0) {
      console.warn("[OpenTrancy] No caption tracks found for video:", videoId);
      this.isLoading = false;
      window.dispatchEvent(new CustomEvent("open-trancy:no-captions", { detail: { videoId } }));
      return null;
    }

    // 4. Select best track
    const selectedTrack = this.selectBestTrack(tracks);
    console.log("[OpenTrancy] Selected caption track:", selectedTrack);

    // 5. Fetch timedtext
    const rawEvents = await this.fetchTimedText(selectedTrack.baseUrl);
    if (!rawEvents || rawEvents.length === 0) {
      this.isLoading = false;
      return null;
    }

    // 6. Parse and segment into sentences
    const rawCues = this.parseEventsToCues(rawEvents);
    const segmentedCues = this.mergeSentenceSegments(rawCues);

    // 7. Request translation from background service worker
    window.dispatchEvent(new CustomEvent("open-trancy:translating-start", { detail: { videoId } }));
    
    try {
      const resp = await OpenTrancyUtils.sendMessageToBackground({
        action: "TRANSLATE_SUBTITLES",
        cues: segmentedCues,
        videoId
      });

      if (resp && resp.success && resp.data) {
        this.cues = resp.data;
      } else {
        // Fallback: use untranslated cues
        this.cues = segmentedCues;
      }
    } catch (err) {
      console.error("[OpenTrancy] Translation failed, using original subtitles:", err);
      this.cues = segmentedCues;
    }

    this.isLoading = false;
    window.dispatchEvent(new CustomEvent("open-trancy:cues-ready", {
      detail: { cues: this.cues, videoId }
    }));

    return this.cues;
  }

  waitForTracks(timeoutMs) {
    return new Promise((resolve) => {
      if (this.currentTracks && this.currentTracks.length > 0) {
        resolve(this.currentTracks);
        return;
      }
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const listener = (event) => {
        if (event.data?.source === "OPEN_TRANCY_PAGE_BRIDGE" && event.data?.action === "CAPTION_TRACKS_FOUND") {
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
      console.warn("[OpenTrancy] Fallback HTML scrape failed:", e);
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
        const data = await res.json();
        return data.events || [];
      }
    } catch (e) {
      // Content script fetch failed, fallback to background service worker
    }

    try {
      const bgRes = await OpenTrancyUtils.sendMessageToBackground({
        action: "FETCH_TIMEDTEXT",
        url
      });
      if (bgRes && bgRes.success) {
        return bgRes.events || [];
      }
    } catch (err) {
      console.error("[OpenTrancy] Background timedtext fetch failed:", err);
    }

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

      // Merge if:
      // 1. Not ended with punctuation AND silence gap is small (< 1.5s) AND length isn't too long (< 20 words)
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

    // Re-index
    return merged.map((c, i) => ({ ...c, id: i }));
  }
}

if (typeof window !== "undefined") {
  window.OpenTrancyCaptions = new YouTubeCaptionManager();
}
