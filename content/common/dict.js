/**
 * OpenTrancy Word Tokenizer & Dictionary Lookup Helper
 */

// Tokenizes text into interactive word spans and punctuation
function tokenizeTextToHtml(text) {
  if (!text) return "";
  const esc = (s) => (window.OpenTrancyUtils ? window.OpenTrancyUtils.escapeHtml(s) : s);

  // Split on word boundaries while keeping words and non-words
  const tokens = text.match(/[\w'’-]+|[^\w'’-]+/g) || [text];
  return tokens.map(token => {
    // If it's a word (contains letters/digits)
    if (/^[\w'’-]+$/.test(token)) {
      const cleanWord = token.replace(/^[\W_]+|[\W_]+$/g, "").toLowerCase();
      if (cleanWord.length > 0) {
        return `<span class="ot-word" data-word="${esc(cleanWord)}">${esc(token)}</span>`;
      }
    }
    return esc(token);
  }).join("");
}

// In-memory cache for word definitions
const wordCache = new Map();

async function lookupWord(word) {
  if (!word) return null;
  const cleanWord = word.trim().toLowerCase();
  if (wordCache.has(cleanWord)) {
    return wordCache.get(cleanWord);
  }

  try {
    const res = await OpenTrancyUtils.sendMessageToBackground({
      action: "LOOKUP_WORD",
      word: cleanWord
    });
    if (res && res.success && res.data) {
      wordCache.set(cleanWord, res.data);
      return res.data;
    }
    return null;
  } catch (err) {
    console.warn("[OpenTrancy] Word lookup failed:", err);
    return null;
  }
}

if (typeof window !== "undefined") {
  window.OpenTrancyDict = {
    tokenizeTextToHtml,
    lookupWord
  };
}
