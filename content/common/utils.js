/**
 * OpenTrancy Common Utilities
 */

const DEFAULT_SETTINGS = {
  engine: "google_free", // "google_free" | "google_api" | "openrouter"
  openRouterKey: "",
  openRouterModel: "google/gemini-2.5-flash",
  googleApiKey: "",
  targetLang: "zh-TW", // "zh-TW" | "zh-CN" | "en" | "ja" | "ko" | "es" | "fr" | "de"
  youtubeSubtitleEnabled: true,
  youtubeSidebarEnabled: true,
  youtubeFontSize: 20,
  youtubeOriginFontSize: 14,
  youtubeSubColor: "#ffffff",
  youtubeSubBg: "rgba(0, 0, 0, 0.75)",
  youtubePrimaryOrder: "target_first", // "target_first" (Target on top) | "origin_first" (Original on top)
  webBilingualEnabled: false,
  webSelectionEnabled: true,
  webFloatingBallEnabled: true,
  shortcutsEnabled: true
};

function getSettings() {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
        resolve({ ...DEFAULT_SETTINGS, ...items });
      });
    } else {
      resolve(DEFAULT_SETTINGS);
    }
  });
}

function saveSettings(newSettings) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(newSettings, () => {
        resolve();
      });
    } else {
      resolve();
    }
  });
}

function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error("Chrome runtime not available"));
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
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
  window.OpenTrancyUtils = {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    sendMessageToBackground,
    formatTime,
    escapeHtml,
    debounce,
    throttle,
    speakText
  };
}
