/**
 * Brancy Background Service Worker
 */

import { translateSubtitleCues, translateWebTexts, lookupWordDetails, refinementContext, refineTranslations } from "./translator.js";
import { callOpenRouter } from "./openrouter.js";
import { registerPageMenu } from "./page-translation.js";

const DEFAULT_SETTINGS = {
  openRouterKey: "",
  openRouterModel: "deepseek/deepseek-v4-flash-0731",
  targetLang: "zh-TW",
  youtubeSubtitleEnabled: true,
  youtubeFontSize: 20,
  youtubeOriginFontSize: 14,
  youtubeSubColor: "#ffffff",
  youtubeSubBg: "rgba(0, 0, 0, 0.75)",
  youtubePrimaryOrder: "target_first",
  webBilingualEnabled: false,
  webSelectionEnabled: true,
  shortcutsEnabled: true
};

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[Brancy] Extension installed or updated:", details.reason);
  const current = await getSettings();
  const merged = { ...DEFAULT_SETTINGS, ...current };
  // Upgrade the old bundled model while preserving user-entered model IDs.
  if (details.reason === "update" && current.openRouterModel === "google/gemini-2.5-flash") {
    merged.openRouterModel = DEFAULT_SETTINGS.openRouterModel;
  }
  await chrome.storage.local.set(merged);
  await chrome.storage.local.remove(["engine", "googleApiKey"]);
  await registerPageMenu();
});

chrome.runtime.onStartup.addListener(() => {
  registerPageMenu().catch(console.error);
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
    const storedSettings = await getSettings();
    const settings = message.youtubeSubtitle === true || message.action === "TRANSLATE_SUBTITLES"
      ? { ...storedSettings, targetLang: "zh-TW" } : storedSettings;

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
          return { success: true, data: results, refinement: refinementContext(settings) };
        } catch (err) {
          console.error("[Brancy] TRANSLATE_TEXTS error:", err);
          return { success: false, error: err.message };
        }
      }

      case "TRANSLATE_SUBTITLES": {
        try {
          const cues = await translateSubtitleCues(message.cues, settings, message.videoId);
          return { success: true, data: cues, refinement: refinementContext(settings) };
        } catch (err) {
          console.error("[Brancy] TRANSLATE_SUBTITLES error:", err);
          return { success: false, error: err.message };
        }
      }

      case "LOOKUP_WORD": {
        try {
          const data = await lookupWordDetails(message.word, settings);
          return { success: true, data, refinement: refinementContext(settings) };
        } catch (err) {
          console.error("[Brancy] LOOKUP_WORD error:", err);
          return { success: false, error: err.message };
        }
      }

      case "REFINE_TEXTS": {
        const data = await refineTranslations(message.texts, message.drafts, message.context, settings);
        return { success: true, data };
      }

      case "TEST_API_KEY": {
        const reply = await callOpenRouter({ apiKey: message.key, model: message.model,
          messages: [{ role: "user", content: "Reply with 'OK'" }] });
        return { success: true, reply };
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
