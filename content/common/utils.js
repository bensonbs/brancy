/**
 * Brancy Common Utilities
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
    try {
      if (!isExtensionValid() || !chrome.runtime?.sendMessage) {
        return reject(new Error("擴充功能已被重新整理，請按 F5 重新整理此頁面即可恢復！"));
      }

      let handled = false;
      const onDone = (response, err) => {
        if (handled) return;
        handled = true;
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
      reject(new Error("擴充功能已被重新整理，請按 F5 重新整理此頁面即可恢復！"));
    }
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
  window.BrancyUtils = {
    DEFAULT_SETTINGS,
    isExtensionValid,
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
