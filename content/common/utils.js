/**
 * Brancy Common Utilities
 */

(function () {
  if (typeof window !== "undefined" && window.BrancyUtils?.__brancyReady) return;

const DEFAULT_SETTINGS = {
  openRouterKey: "",
  openRouterModel: "deepseek/deepseek-v4-flash-0731",
  targetLang: "zh-TW", // "zh-TW" | "zh-CN" | "en" | "ja" | "ko" | "es" | "fr" | "de"
  youtubeSubtitleEnabled: true,
  youtubeFontSize: 20,
  youtubeOriginFontSize: 14,
  youtubeSubColor: "#ffffff",
  youtubeSubBg: "rgba(0, 0, 0, 0.75)",
  youtubePrimaryOrder: "target_first", // "target_first" (Target on top) | "origin_first" (Original on top)
  webBilingualEnabled: false,
  webSelectionEnabled: true,
  shortcutsEnabled: true
};

function isExtensionValid() {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

function getSettings() {
  return new Promise((resolve) => {
    try {
      if (isExtensionValid() && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
          if (chrome.runtime?.lastError) {
            resolve(DEFAULT_SETTINGS);
          } else {
            resolve({ ...DEFAULT_SETTINGS, ...items });
          }
        });
      } else {
        resolve(DEFAULT_SETTINGS);
      }
    } catch (e) {
      resolve(DEFAULT_SETTINGS);
    }
  });
}

function saveSettings(newSettings) {
  return new Promise((resolve) => {
    try {
      if (isExtensionValid() && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(newSettings, () => {
          resolve();
        });
      } else {
        resolve();
      }
    } catch (e) {
      resolve();
    }
  });
}

function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    let timeout;
    try {
      if (!isExtensionValid() || !chrome.runtime?.sendMessage) {
        return reject(new Error("擴充功能已被重新整理，請按 F5 重新整理此頁面即可恢復！"));
      }

      let handled = false;
      const onDone = (response, err) => {
        if (handled) return;
        handled = true;
        clearTimeout(timeout);
        if (err) {
          const msg = err.message || String(err);
          if (msg.includes("context invalidated") || msg.includes("Receiving end does not exist")) {
            reject(new Error("擴充功能已被重新整理，請按 F5 重新整理此頁面即可恢復！"));
          } else {
            reject(new Error(msg));
          }
        } else {
          resolve(response);
        }
      };

      if (message.action === "TRANSLATE_SUBTITLES" || (message.youtubeSubtitle && message.action === "TRANSLATE_TEXTS")) {
        timeout = setTimeout(() => onDone(null, new Error("翻譯逾時，請稍後再試")), 20000);
      }
      const sendRes = chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime?.lastError) {
          onDone(null, chrome.runtime.lastError);
        } else {
          onDone(response, null);
        }
      });

      // Catch potential promise rejection returned in Chrome MV3
      if (sendRes && typeof sendRes.catch === "function") {
        sendRes.catch((err) => {
          onDone(null, err);
        });
      }
    } catch (err) {
      clearTimeout(timeout);
      reject(new Error("擴充功能已被重新整理，請按 F5 重新整理此頁面即可恢復！"));
    }
  });
}

// Google completion resolves immediately. OpenRouter work is queued separately
// so slow second passes never hold up later Google batches or flood the API.
let translationSettingsRevision = 0;
const refinementQueue = [];
const pendingTranslations = new Set();
let runningRefinements = 0;
if (typeof chrome !== "undefined") chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && ["targetLang", "openRouterKey", "openRouterModel"].some(key => changes[key])) {
    translationSettingsRevision++;
    for (const cancel of pendingTranslations) cancel();
    pendingTranslations.clear();
    for (const job of refinementQueue) job.finish();
    refinementQueue.length = 0;
  }
});

function drainRefinements() {
  while (runningRefinements < 2 && refinementQueue.length) {
    // Re-evaluate priorities when a slot frees up (the video may have sought).
    refinementQueue.sort((a, b) => a.priority() - b.priority());
    const job = refinementQueue.shift();
    if (!job.isCurrent()) { job.finish(); continue; }
    runningRefinements++;
    job.run().catch(() => {}).finally(() => { job.finish(); runningRefinements--; drainRefinements(); });
  }
}

async function translateProgressively(message, { onUpdate, isCurrent = () => true, priority = () => Infinity }) {
  const settingsRevision = translationSettingsRevision;
  const current = () => settingsRevision === translationSettingsRevision && isCurrent();
  const response = await sendMessageToBackground(message);
  if (!current()) return response;
  const sources = message.texts || message.cues?.map(cue => cue.text) || [message.word];
  const subtitle = message.action === "TRANSLATE_SUBTITLES";
  const word = message.action === "LOOKUP_WORD";
  const drafts = subtitle ? response?.data?.map(cue => cue.translation || "")
    : word ? [response?.data?.translation || ""] : response?.data;
  const data = response?.data;
  const stages = sources.map(() => response?.refinement ? "pending" : "google-only");
  const statuses = sources.map(() => "");
  const publish = () => onUpdate({ ...response, data: subtitle ? data.map(cue => ({ ...cue }))
    : word ? { ...data } : [...data], stages: [...stages], statuses: [...statuses] });
  if (!response?.success || !Array.isArray(drafts)) { onUpdate(response); return response; }
  publish();
  if (!response.refinement || !sources.length || !current()) return response;
  let batch = [], characters = 0, pendingJobs = 0;
  const cancel = () => {
    if (!isCurrent()) return;
    stages.forEach((stage, index) => {
      if (stage === "pending") {
        stages[index] = "google";
        statuses[index] = "設定已變更，保留 Google 暫譯；請重新翻譯。";
      }
    });
    publish();
  };
  pendingTranslations.add(cancel);
  const enqueue = indices => {
    pendingJobs++;
    refinementQueue.push({ isCurrent: current, priority,
      finish: () => { if (--pendingJobs === 0) pendingTranslations.delete(cancel); }, run: async () => {
    try {
      const refined = await sendMessageToBackground({ action: "REFINE_TEXTS", youtubeSubtitle: message.youtubeSubtitle === true || subtitle, context: response.refinement,
        texts: indices.map(i => sources[i]), drafts: indices.map(i => drafts[i]) });
      if (!current()) return;
      if (!refined?.success || !Array.isArray(refined.data) || refined.data.length !== indices.length) {
        throw new Error(refined?.error || "補譯未完成");
      }
      indices.forEach((index, i) => {
        const value = refined.data[i];
        // A missing/unchanged source response must not erase an existing draft.
        if (typeof value === "string" && value.trim() && (value.trim() !== sources[index].trim() || drafts[index] === sources[index])) {
          if (subtitle) data[index] = { ...data[index], translation: value };
          else if (word) data.translation = value;
          else data[index] = value;
          stages[index] = "openrouter";
        } else { stages[index] = "google"; statuses[index] = "補譯未完成，保留 Google 暫譯"; }
      });
    } catch (error) {
      if (!current()) return;
      indices.forEach(index => { stages[index] = "google"; statuses[index] = `補譯未完成，保留 Google 暫譯：${error.message}`; });
    }
    if (current()) publish();
  } });
  };
  sources.forEach((text, i) => {
    if (batch.length >= 8 || (batch.length && characters + text.length > 6000)) { enqueue(batch); batch = []; characters = 0; }
    batch.push(i); characters += text.length;
  });
  if (batch.length) enqueue(batch);
  drainRefinements();
  return response;
}

function translationStageLabel(stage) {
  return stage === "google-only" ? "" : stage === "openrouter" ? "OpenRouter" : stage === "pending" ? "Google 暫譯 · OpenRouter 補譯中…" : "Google 暫譯";
}

// Strip square-bracket annotations from subtitles, including nested labels.
// Preserve ordinary parenthetical dialogue; retain the existing music-only
// filtering for round parentheses.
function stripSubtitleAnnotations(text) {
  let cleaned = String(text || "");
  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(/\[[^\[\]]*\]|【[^【】]*】|［[^［］]*］/g, " ");
  } while (cleaned !== previous);
  return cleaned.replace(/\(\s*(?:music|音樂|音乐|音楽)\s*\)|（\s*(?:music|音樂|音乐|音楽)\s*）/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

function throttle(fn, limit) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

function speakText(text, lang = "en-US") {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

// Attach to window for standard content scripts
if (typeof window !== "undefined") {
  window.BrancyUtils = {
    __brancyReady: true,
    DEFAULT_SETTINGS,
    isExtensionValid,
    getSettings,
    saveSettings,
    sendMessageToBackground,
    translateProgressively,
    translationStageLabel,
    stripSubtitleAnnotations,
    formatTime,
    escapeHtml,
    debounce,
    throttle,
    speakText
  };
}
if (typeof window !== "undefined") window.dispatchEvent(new Event("brancy:utils-ready"));
})();
