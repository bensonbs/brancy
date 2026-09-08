/**
 * OpenTrancy Translation Service Dispatcher & Cache
 */

import { translateSubtitlesWithOpenRouter, translateWebTextsWithOpenRouter, callOpenRouter } from "./openrouter.js";

// In-memory memory cache for fast lookups
const memoryCache = new Map();

/**
 * Free Google Translate Web Endpoint (client=gtx)
 */
export async function translateSingleGoogleFree(text, targetLang = "zh-TW") {
  if (!text || !text.trim()) return "";
  
  // Google target lang mapping
  const gTarget = targetLang === "zh-TW" ? "zh-TW" : targetLang === "zh-CN" ? "zh-CN" : targetLang;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(gTarget)}&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Translate 失敗: HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data || !data[0]) return text;

  // data[0] is an array of segments: [[ "translated segment", "original segment" ], ...]
  return data[0].map(item => item[0]).filter(Boolean).join("");
}

/**
 * Batch translation with Google Free using concurrent chunking
 */
export async function translateBatchGoogleFree(texts, targetLang = "zh-TW") {
  if (!texts || texts.length === 0) return [];
  
  const results = new Array(texts.length);
  const concurrency = 5;
  
  for (let i = 0; i < texts.length; i += concurrency) {
    const chunk = texts.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (txt, idx) => {
      const realIndex = i + idx;
      if (!txt || !txt.trim()) {
        results[realIndex] = txt;
        return;
      }
      try {
        const trans = await translateSingleGoogleFree(txt, targetLang);
        results[realIndex] = trans;
      } catch (err) {
        console.warn("[GoogleFree] Failed for text:", txt, err);
        results[realIndex] = txt;
      }
    });
    await Promise.all(chunkPromises);
  }
  
  return results;
}

/**
 * Google Cloud Official Translation API v2
 */
export async function translateGoogleCloudAPI({ apiKey, texts, targetLang = "zh-TW" }) {
  if (!apiKey) {
    throw new Error("請先在 OpenTrancy 設定頁面填寫 Google Cloud Translation API Key！");
  }
  if (!texts || texts.length === 0) return [];

  const gTarget = targetLang === "zh-TW" ? "zh-TW" : targetLang === "zh-CN" ? "zh-CN" : targetLang;
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey.trim()}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: texts,
      target: gTarget,
      format: "text"
    })
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Google Cloud API 錯誤 (${res.status}): ${errorBody}`);
  }

  const data = await res.json();
  const translations = data?.data?.translations;
  if (!translations || !Array.isArray(translations)) {
    throw new Error("Google Cloud API 回傳格式錯誤");
  }

  return translations.map(t => t.translatedText);
}

/**
 * Translate an array of subtitle cues using the configured engine
 */
export async function translateSubtitleCues(cues, settings, videoId) {
  if (!cues || cues.length === 0) return [];

  const targetLang = settings.targetLang || "zh-TW";
  const engine = settings.engine || "google_free";
  const model = settings.openRouterModel || "google/gemini-2.5-flash";

  // Check storage cache
  const cacheKey = `sub_${videoId}_${targetLang}_${engine}_${engine === "openrouter" ? model : ""}`;
  const cached = await getFromStorage(cacheKey);
  if (cached && Array.isArray(cached) && cached.length === cues.length) {
    console.log("[OpenTrancy] Subtitles loaded from cache:", cacheKey);
    return cached;
  }

  let translatedCues = [];

  if (engine === "openrouter") {
    // Translate with OpenRouter in chunks of 25 sentences for best speed and accuracy
    const CHUNK_SIZE = 25;
    translatedCues = [];
    
    for (let i = 0; i < cues.length; i += CHUNK_SIZE) {
      const chunk = cues.slice(i, i + CHUNK_SIZE);
      const translatedChunk = await translateSubtitlesWithOpenRouter({
        apiKey: settings.openRouterKey,
        model: settings.openRouterModel,
        cues: chunk,
        targetLang
      });
      translatedCues.push(...translatedChunk);
    }
  } else if (engine === "google_api") {
    const texts = cues.map(c => c.text);
    const translatedTexts = await translateGoogleCloudAPI({
      apiKey: settings.googleApiKey,
      texts,
      targetLang
    });
    translatedCues = cues.map((cue, idx) => ({
      ...cue,
      translation: translatedTexts[idx] || cue.text
    }));
  } else {
    // Default: google_free
    const texts = cues.map(c => c.text);
    const translatedTexts = await translateBatchGoogleFree(texts, targetLang);
    translatedCues = cues.map((cue, idx) => ({
      ...cue,
      translation: translatedTexts[idx] || cue.text
    }));
  }

  // Save to storage cache asynchronously
  if (videoId && translatedCues.length > 0) {
    saveToStorage(cacheKey, translatedCues).catch(e => console.warn("Cache save failed:", e));
  }

  return translatedCues;
}

/**
 * Translate general webpage texts (array of strings)
 */
export async function translateWebTexts(texts, settings) {
  if (!texts || texts.length === 0) return [];

  const targetLang = settings.targetLang || "zh-TW";
  const engine = settings.engine || "google_free";

  if (engine === "openrouter") {
    return await translateWebTextsWithOpenRouter({
      apiKey: settings.openRouterKey,
      model: settings.openRouterModel,
      texts,
      targetLang
    });
  } else if (engine === "google_api") {
    return await translateGoogleCloudAPI({
      apiKey: settings.googleApiKey,
      texts,
      targetLang
    });
  } else {
    // google_free
    return await translateBatchGoogleFree(texts, targetLang);
  }
}

/**
 * Look up word details: dictionary definition + phonetic + audio + translation
 */
export async function lookupWordDetails(word, settings) {
  if (!word) return null;
  const cleanWord = word.trim().toLowerCase();
  const targetLang = settings.targetLang || "zh-TW";

  let dictData = null;
  // Try free dictionary API for English words
  try {
    const dictRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
    if (dictRes.ok) {
      const entries = await dictRes.json();
      if (Array.isArray(entries) && entries.length > 0) {
        const entry = entries[0];
        const phoneticText = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || "";
        const audioUrl = entry.phonetics?.find(p => p.audio && p.audio.length > 0)?.audio || "";
        
        const meanings = (entry.meanings || []).slice(0, 3).map(m => ({
          partOfSpeech: m.partOfSpeech,
          definition: m.definitions?.[0]?.definition || "",
          example: m.definitions?.[0]?.example || ""
        }));

        dictData = {
          word: entry.word,
          phonetic: phoneticText,
          audio: audioUrl,
          meanings
        };
      }
    }
  } catch (e) {
    console.warn("Dictionary API error:", e);
  }

  // Get translation of the word itself
  let translation = "";
  try {
    translation = await translateSingleGoogleFree(cleanWord, targetLang);
  } catch (e) {
    translation = "";
  }

  return {
    word: cleanWord,
    translation,
    phonetic: dictData?.phonetic || "",
    audio: dictData?.audio || "",
    meanings: dictData?.meanings || []
  };
}

// Storage helpers for caching
function getFromStorage(key) {
  return new Promise(resolve => {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve(null);
      return;
    }
    chrome.storage.local.get([key], res => {
      resolve(res ? res[key] : null);
    });
  });
}

function saveToStorage(key, value) {
  return new Promise(resolve => {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve();
      return;
    }
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}
