/**
 * OpenRouter AI API Client
 */

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function callOpenRouter({ apiKey, model, messages, temperature = 0.3 }) {
  if (!apiKey) {
    throw new Error("請先在 Brancy 設定頁面填寫 OpenRouter API Key！");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 18000);

  try {
    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "HTTP-Referer": "https://github.com/brancy",
        "X-Title": "Brancy Extension",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "google/gemini-2.5-flash",
        temperature,
        messages
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorJson = null;
      try {
        errorJson = JSON.parse(errorText);
      } catch (e) {}
      const msg = errorJson?.error?.message || errorText || `HTTP ${res.status}`;
      throw new Error(`OpenRouter API 錯誤 (${res.status}): ${msg}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenRouter 回應為空");
    }
    return content.trim();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("OpenRouter 連線逾時（超過 18 秒未回應）");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Translate an array of subtitle cues using OpenRouter.
 * Preserves cue index and natural conversational flow.
 */
export async function translateSubtitlesWithOpenRouter({ apiKey, model, cues, targetLang = "zh-TW" }) {
  if (!cues || cues.length === 0) return [];

  // Map language codes to human-readable names for prompt
  const langNames = {
    "zh-TW": "繁體中文 (Traditional Chinese, Taiwan/Hong Kong style)",
    "zh-CN": "簡體中文 (Simplified Chinese)",
    "en": "English",
    "ja": "日本語 (Japanese)",
    "ko": "한국어 (Korean)",
    "es": "Español (Spanish)",
    "fr": "Français (French)",
    "de": "Deutsch (German)"
  };
  const targetLangDesc = langNames[targetLang] || targetLang;

  // Prepare batch lines
  const inputList = cues.map((c, i) => ({ id: i, text: c.text }));

  const systemPrompt = `You are a world-class subtitle translator and language localization expert.
Your mission: Translate the provided subtitle segments into ${targetLangDesc}.
Rules:
1. Deliver natural, conversational, and context-aware translations suitable for video subtitles.
2. Keep the translations concise and punchy so viewers can read them comfortably while watching video.
3. You MUST maintain the exact mapping for each item id.
4. Output STRICTLY a valid JSON array of objects with schema: [{"id": number, "trans": string}].
5. Do NOT include any markdown codeblocks or conversational preamble. Return pure JSON only.`;

  const userPrompt = JSON.stringify(inputList);

  const rawOutput = await callOpenRouter({
    apiKey,
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  // Extract JSON from output (clean up markdown if LLM wrapped in ```json ... ```)
  let cleanJson = rawOutput;
  if (cleanJson.includes("```")) {
    cleanJson = cleanJson.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  }

  try {
    const parsed = JSON.parse(cleanJson);
    const translationMap = new Map();
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item.id === "number" && typeof item.trans === "string") {
          translationMap.set(item.id, item.trans);
        }
      }
    }

    if (translationMap.size === 0) {
      throw new Error("OpenRouter 回應未包含有效翻譯項目");
    }

    return cues.map((cue, i) => ({
      ...cue,
      translation: translationMap.get(i) || cue.text
    }));
  } catch (err) {
    console.error("[OpenRouter] Failed to parse subtitle JSON response:", rawOutput, err);
    throw err; // Re-throw to trigger fallback to Google Free
  }
}

/**
 * Translate web paragraphs in batch using OpenRouter.
 */
export async function translateWebTextsWithOpenRouter({ apiKey, model, texts, targetLang = "zh-TW" }) {
  if (!texts || texts.length === 0) return [];

  const langNames = {
    "zh-TW": "繁體中文 (Traditional Chinese)",
    "zh-CN": "簡體中文 (Simplified Chinese)",
    "en": "English",
    "ja": "日本語 (Japanese)",
    "ko": "한국어 (Korean)",
    "es": "Español",
    "fr": "Français",
    "de": "Deutsch"
  };
  const targetLangDesc = langNames[targetLang] || targetLang;

  const systemPrompt = `You are a professional translator. Translate each of the following webpage text elements into fluent, natural ${targetLangDesc}.
Strictly preserve the number of elements and their order.
Return pure JSON format: a single array of translated strings: ["trans1", "trans2", ...]. No markdown fences.`;

  const raw = await callOpenRouter({
    apiKey,
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(texts) }
    ]
  });

  let clean = raw;
  if (clean.includes("```")) {
    clean = clean.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  }

  try {
    const list = JSON.parse(clean);
    if (Array.isArray(list) && list.length === texts.length) {
      return list;
    }
  } catch (e) {
    console.warn("[OpenRouter] Could not parse array from LLM, attempting line split:", e);
  }

  // Fallback: split by lines
  const lines = clean.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length === texts.length) {
    return lines;
  }
  
  throw new Error(`OpenRouter 翻譯回傳格式不符 (期望 ${texts.length} 項，收到 ${lines.length} 行)`);
}
