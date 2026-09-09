/**
 * Brancy Translation Service Dispatcher & Cache
 */

import { translateSubtitlesWithOpenRouter, translateWebTextsWithOpenRouter } from "./openrouter.js";


/**
 * Free Google Translate Web Endpoint (client=dict-chrome-ex / gtx)
 */
export async function translateSingleGoogleFree(text, targetLang = "zh-TW") {
  if (!text || !text.trim()) return "";
  
  const gTarget = targetLang === "zh-TW" ? "zh-TW" : targetLang === "zh-CN" ? "zh-CN" : targetLang;

  // 1. Try clients5 POST (fast, dedicated Chrome extension endpoint)
  try {
    const params = new URLSearchParams({
      sl: "auto",
      tl: gTarget,
      q: text
    });
    const res = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]) {
        const item = data[0];
        const trans = Array.isArray(item) ? item[0] : (typeof item === "string" ? item : "");
        if (trans) return trans;
      }
    }
  } catch (e) {
    console.warn("[Brancy] clients5 single POST failed, trying gtx endpoint:", e);
  }

  // 2. Fallback to translate.googleapis.com client=gtx
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(gTarget)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Translate 失敗: HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data || !data[0]) return text;

  // data[0] is an array of segments: [[ "translated segment", "original segment" ], ...]
  return data[0].map(item => (Array.isArray(item) ? item[0] : "")).filter(Boolean).join("");
}

/**
 * High-performance batch translation with Google Free
 * Uses clients5 multi-q POST to translate up to 40 items in ONE single HTTP request!
 */
export async function translateBatchGoogleFree(texts, targetLang = "zh-TW") {
  if (!texts || texts.length === 0) return [];
  
  const gTarget = targetLang === "zh-TW" ? "zh-TW" : targetLang === "zh-CN" ? "zh-CN" : targetLang;
  const CHUNK_SIZE = 40;
  const results = [];

  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);

    // 1. Try batch POST with clients5.google.com
    let chunkSuccess = false;
    try {
      const params = new URLSearchParams();
      params.append("sl", "auto");
      params.append("tl", gTarget);
      for (const t of chunk) {
        params.append("q", t || "");
      }

      const res = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length === chunk.length) {
          chunk.forEach((txt, idx) => {
            const item = data[idx];
            const translated = Array.isArray(item) ? item[0] : (typeof item === "string" ? item : "");
            results.push(translated || txt);
          });
          chunkSuccess = true;
        }
      }
    } catch (err) {
      console.warn("[Brancy] clients5 batch POST error, falling back:", err);
    }

    if (chunkSuccess) continue;

    // 2. Fallback: item-by-item with translateSingleGoogleFree
    for (const txt of chunk) {
      if (!txt || !txt.trim()) {
        results.push(txt);
        continue;
      }
      try {
        const trans = await translateSingleGoogleFree(txt, gTarget);
        results.push(trans || txt);
      } catch (singleErr) {
        console.warn("[Brancy] Single fallback error for text:", txt, singleErr);
        results.push(txt); // Return original text rather than empty string on failure
      }
    }
  }
  
  return results;
}

/**
 * Google Cloud Official Translation API v2
 */
export async function translateGoogleCloudAPI({ apiKey, texts, targetLang = "zh-TW" }) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("請先在 Brancy 設定頁面填寫 Google Cloud Translation API Key！");
  }
  if (!texts || texts.length === 0) return [];

  const gTarget = targetLang === "zh-TW" ? "zh-TW" : targetLang === "zh-CN" ? "zh-CN" : targetLang;
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey.trim())}`;

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
  let engine = settings.engine || "google_free";
  const model = settings.openRouterModel || "deepseek/deepseek-v4-flash-0731";

  validateEngineSettings(settings);

  // Check storage cache
  const cacheKey = `sub_${videoId}_${targetLang}_${engine}_${engine === "openrouter" ? model : ""}`;
  const cached = await getFromStorage(cacheKey);
  if (Array.isArray(cached) && cached.length === cues.length && cached.every((cue, i) =>
    cue.text === cues[i].text && cue.start === cues[i].start && cue.end === cues[i].end)) {
    // Validate cache: ensure it actually contains translations and is not just English copied over
    const hasValidTranslation = cached.some(c => c.translation && c.translation.trim().toLowerCase() !== c.text.trim().toLowerCase());
    if (hasValidTranslation) {
      console.log("[Brancy] Subtitles loaded from cache:", cacheKey);
      return cues.map((cue, i) => ({ ...cue, translation: cached[i].translation }));
    } else {
      console.warn("[Brancy] Stale untranslated cache detected, discarding:", cacheKey);
      await removeFromStorage(cacheKey);
    }
  }

  let translatedCues = [];
  if (engine === "openrouter") {
    for (let i = 0; i < cues.length; i += 8) {
      translatedCues.push(...await translateSubtitlesWithOpenRouter({
        apiKey: settings.openRouterKey, model: settings.openRouterModel,
        cues: cues.slice(i, i + 8), targetLang
      }));
    }
  } else {
    const translations = await translateWebTexts(cues.map(cue => cue.text), settings);
    translatedCues = cues.map((cue, i) => ({ ...cue, translation: translations[i] || cue.text }));
  }

  // Save to storage cache asynchronously only if actual translations exist
  const hasValidTranslation = translatedCues.some(c => c.translation && c.translation.trim().toLowerCase() !== c.text.trim().toLowerCase());
  if (videoId && translatedCues.length > 0 && hasValidTranslation) {
    saveToStorage(cacheKey, translatedCues).catch(e => console.warn("Cache save failed:", e));
  }

  return translatedCues;
}

/**
 * Translate general webpage texts (array of strings)
 */
function validateEngineSettings(settings) {
  if (settings.engine === "openrouter") {
    if (!settings.openRouterKey?.trim()) throw new Error("請先在 Brancy 設定頁面填寫 OpenRouter API Key。");
    if (!settings.openRouterModel?.trim()) throw new Error("請先在 Brancy 設定頁面輸入 OpenRouter 模型名稱。");
  }
  if (settings.engine === "google_api" && !settings.googleApiKey?.trim()) {
    throw new Error("請先在 Brancy 設定頁面填寫 Google 翻譯 API Key。");
  }
}

export async function translateWebTexts(texts, settings) {
  if (!texts?.length) return [];
  validateEngineSettings(settings);
  const targetLang = settings.targetLang || "zh-TW";
  if (settings.engine === "openrouter") {
    const translated = [];
    let batch = [], characters = 0;
    const flush = async () => {
      if (!batch.length) return;
      translated.push(...await translateWebTextsWithOpenRouter({
        apiKey: settings.openRouterKey, model: settings.openRouterModel, texts: batch, targetLang
      }));
      batch = []; characters = 0;
    };
    for (const text of texts) {
      if (batch.length >= 8 || (batch.length && characters + text.length > 6000)) await flush();
      batch.push(text); characters += text.length;
    }
    await flush();
    return translated;
  }
  if (settings.engine === "google_api") {
    const translated = [];
    for (let i = 0; i < texts.length; i += 100) {
      translated.push(...await translateGoogleCloudAPI({ apiKey: settings.googleApiKey,
        texts: texts.slice(i, i + 100), targetLang }));
    }
    return translated;
  }
  return translateBatchGoogleFree(texts, targetLang);
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
    [translation] = await translateWebTexts([cleanWord], settings);
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

function removeFromStorage(key) {
  return new Promise(resolve => {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve();
      return;
    }
    chrome.storage.local.remove([key], () => resolve());
  });
}
