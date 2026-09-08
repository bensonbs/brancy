/**
 * OpenTrancy Background Service Worker
 */

import { translateSubtitleCues, translateWebTexts, lookupWordDetails } from "./translator.js";
import { callOpenRouter } from "./openrouter.js";

const DEFAULT_SETTINGS = {
  engine: "google_free", // "google_free" | "google_api" | "openrouter"
  openRouterKey: "",
  openRouterModel: "google/gemini-2.5-flash",
  googleApiKey: "",
  targetLang: "zh-TW",
  youtubeSubtitleEnabled: true,
  youtubeSidebarEnabled: true,
  youtubeFontSize: 20,
  youtubeOriginFontSize: 14,
  youtubeSubColor: "#ffffff",
  youtubeSubBg: "rgba(0, 0, 0, 0.75)",
  youtubePrimaryOrder: "target_first",
  webBilingualEnabled: false,
  webSelectionEnabled: true,
  webFloatingBallEnabled: true,
  shortcutsEnabled: true
};

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[OpenTrancy] Extension installed or updated:", details.reason);
  const current = await getSettings();
  const merged = { ...DEFAULT_SETTINGS, ...current };
  await chrome.storage.local.set(merged);
});

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
      resolve({ ...DEFAULT_SETTINGS, ...items });
    });
  });
}

// Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleAsync = async () => {
    const settings = await getSettings();

    switch (message.action) {
      case "GET_SETTINGS":
        return { success: true, settings };

      case "SAVE_SETTINGS":
        await chrome.storage.local.set(message.settings);
        return { success: true };

      case "FETCH_TIMEDTEXT": {
        try {
          const res = await fetch(message.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return { success: true, events: data.events || [] };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case "TRANSLATE_TEXTS": {
        try {
          const results = await translateWebTexts(message.texts, settings);
          return { success: true, data: results };
        } catch (err) {
          console.error("[OpenTrancy] TRANSLATE_TEXTS error:", err);
          return { success: false, error: err.message };
        }
      }

      case "TRANSLATE_SUBTITLES": {
        try {
          const cues = await translateSubtitleCues(message.cues, settings, message.videoId);
          return { success: true, data: cues };
        } catch (err) {
          console.error("[OpenTrancy] TRANSLATE_SUBTITLES error:", err);
          return { success: false, error: err.message };
        }
      }

      case "LOOKUP_WORD": {
        try {
          const data = await lookupWordDetails(message.word, settings);
          return { success: true, data };
        } catch (err) {
          console.error("[OpenTrancy] LOOKUP_WORD error:", err);
          return { success: false, error: err.message };
        }
      }

      case "TEST_API_KEY": {
        try {
          const { engine, key, model } = message;
          if (engine === "openrouter") {
            const reply = await callOpenRouter({
              apiKey: key,
              model: model || "google/gemini-2.5-flash",
              messages: [{ role: "user", content: "Reply with 'OK'" }]
            });
            return { success: true, reply };
          } else if (engine === "google_api") {
            const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${key.trim()}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ q: "hello", target: "zh-TW" })
            });
            if (!res.ok) {
              const err = await res.text();
              throw new Error(`Google Cloud API 失敗: ${err}`);
            }
            return { success: true, reply: "Google Cloud API 金鑰驗證成功！" };
          }
          return { success: true, reply: "Google 免費端點無須金鑰！" };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case "CLEAR_CACHE": {
        const all = await chrome.storage.local.get(null);
        const keysToRemove = Object.keys(all).filter(k => k.startsWith("sub_") || k.startsWith("page_"));
        if (keysToRemove.length > 0) {
          await chrome.storage.local.remove(keysToRemove);
        }
        return { success: true, count: keysToRemove.length };
      }

      default:
        return { success: false, error: "未知 Action" };
    }
  };

  handleAsync().then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });

  return true;
});
