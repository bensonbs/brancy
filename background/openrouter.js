/**
 * OpenRouter AI API Client
 */

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function callOpenRouter({ apiKey, model, messages, temperature = 0.3, timeoutMs = 60000, onContent }) {
  if (!apiKey?.trim()) {
    throw new Error("請先在 Brancy 設定頁面填寫 OpenRouter API Key！");
  }

  if (!model?.trim()) throw new Error("請先在 Brancy 設定頁面輸入 OpenRouter 模型名稱。");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Keep the MV3 worker alive only while this bounded request is in progress.
  const keepAliveId = globalThis.chrome?.runtime?.getPlatformInfo
    ? setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000)
    : null;

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
        model: model.trim(),
        temperature,
        stream: true,
        reasoning: { enabled: false },
        provider: { sort: "latency", preferred_min_throughput: 50 },
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

    const content = res.headers?.get("content-type")?.includes("text/event-stream")
      ? await readCompletionStream(res.body, onContent)
      : (await res.json()).choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenRouter 回應為空");
    }
    return content.trim();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`OpenRouter 連線逾時（超過 ${Math.round(timeoutMs / 1000)} 秒）。請稍後重試，或在設定中切換模型／Google 翻譯。`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (keepAliveId !== null) clearInterval(keepAliveId);
  }
}

// Parse SSE events across arbitrary network and UTF-8 boundaries. Processing
// comments are heartbeats, and a mid-stream error must never become a translation.
async function readCompletionStream(body, onContent) {
  if (!body) throw new Error("OpenRouter 回應為空");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", complete = false;
  const consume = block => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") { complete = true; return; }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error(`OpenRouter：${chunk.error.message || "模型服務中斷"}`);
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason === "error" || choice?.finish_reason === "length") {
      throw new Error("OpenRouter 回應未完成，請縮短文字或更換模型。");
    }
    if (typeof choice?.delta?.content === "string") {
      content += choice.delta.content;
      onContent?.(content);
    }
  };
  try {
    while (!complete) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop();
      for (const event of events) {
        consume(event);
        if (complete) break;
      }
      if (done) {
        if (buffer.trim() && !complete) consume(buffer);
        if (!complete) throw new Error("OpenRouter 連線中斷，翻譯尚未完成。請重試。");
      }
    }
    return content;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
