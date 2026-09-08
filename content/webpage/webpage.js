/**
 * Brancy Immersive Webpage Bilingual Translation with Shimmer Animation
 */

(function () {
  let isTranslating = false;
  let isPageTranslated = false;
  let settings = null;

  async function init() {
    settings = await BrancyUtils.getSettings();
    setupShortcut();

    // Listen for extension popup or background trigger
    chrome.runtime.onMessage?.addListener((msg, sender, sendResponse) => {
      if (msg.action === "TOGGLE_PAGE_TRANSLATION") {
        togglePageTranslation();
        sendResponse({ success: true, isTranslated: isPageTranslated });
      }
    });
  }

  function setupShortcut() {
    document.addEventListener("keydown", (e) => {
      // Alt + T shortcut to toggle bilingual reading
      if (e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        togglePageTranslation();
      }
    });
  }

  async function togglePageTranslation() {
    if (isTranslating) return;

    if (isPageTranslated) {
      restoreOriginalPage();
    } else {
      await translateCurrentPage();
    }
  }

  async function translateCurrentPage() {
    if (isTranslating) return;
    isTranslating = true;

    // Clean up any stale pending markers from aborted runs
    document.querySelectorAll("[data-ot-translated='pending']").forEach(el => {
      delete el.dataset.otTranslated;
    });

    showToast("Brancy: 正在雙語翻譯網頁內容...");

    settings = await BrancyUtils.getSettings();

    // Collect candidate DOM elements
    const candidates = findTranslateCandidates();
    if (candidates.length === 0) {
      showToast("Brancy: 未找到適合翻譯的文章段落");
      isTranslating = false;
      return;
    }

    const BATCH_SIZE = 12;
    let translatedCount = 0;
    let sameLangCount = 0;
    let lastErrorMsg = null;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const texts = batch.map(el => el.innerText.trim());

      // 1. Immediately inject shimmer skeleton placeholders for immediate visual feedback
      const shimmerBlocks = batch.map(el => createShimmerBlock(el));

      try {
        const res = await BrancyUtils.sendMessageToBackground({
          action: "TRANSLATE_TEXTS",
          texts
        });

        if (res && res.success && Array.isArray(res.data)) {
          batch.forEach((el, idx) => {
            const trans = res.data[idx];
            const block = shimmerBlocks[idx];
            const orig = el.innerText.trim();

            if (!trans) {
              if (block) block.remove();
              delete el.dataset.otTranslated;
              return;
            }

            // Normalize and compare ignoring whitespace
            const cleanOrig = orig.replace(/[\s\uFEFF\xA0]+/g, "").toLowerCase();
            const cleanTrans = trans.replace(/[\s\uFEFF\xA0]+/g, "").toLowerCase();

            if (cleanTrans && cleanTrans !== cleanOrig) {
              resolveShimmerBlock(block, el, trans);
              translatedCount++;
            } else {
              // The text is identical to original (already in target language or untranslatable)
              sameLangCount++;
              if (block) block.remove();
              delete el.dataset.otTranslated;
            }
          });
        } else {
          lastErrorMsg = res?.error || "翻譯服務無回應";
          shimmerBlocks.forEach(b => b && b.remove());
          batch.forEach(el => delete el.dataset.otTranslated);
        }
      } catch (err) {
        lastErrorMsg = err.message;
        console.warn("[Brancy] Batch translation error:", err);
        shimmerBlocks.forEach(b => b && b.remove());
        batch.forEach(el => delete el.dataset.otTranslated);
      }
    }

    isTranslating = false;

    if (translatedCount > 0) {
      isPageTranslated = true;
      document.body.classList.add("ot-page-translated");
      showToast(`Brancy: 完成 ${translatedCount} 段文字雙語翻譯！`);
    } else {
      isPageTranslated = false;
      document.body.classList.remove("ot-page-translated");

      if (lastErrorMsg) {
        showToast(`Brancy 翻譯失敗: ${lastErrorMsg}`);
      } else if (sameLangCount > 0) {
        showToast("Brancy: 本頁面內容已是目標語言（或無需翻譯），未檢測到外語段落");
      } else {
        showToast("Brancy: 未能找到需要翻譯的外語段落");
      }
    }
  }

  function restoreOriginalPage() {
    document.querySelectorAll(".brancy-web-trans").forEach(el => el.remove());
    document.querySelectorAll("[data-ot-translated]").forEach(el => delete el.dataset.otTranslated);
    document.body.classList.remove("ot-page-translated");
    isPageTranslated = false;
    showToast("Brancy: 已還原原始網頁");
  }

  function findTranslateCandidates() {
    const selector = "p, h1, h2, h3, h4, h5, h6, li, blockquote, article p, section p, .article-content p, .post-content p";
    const all = Array.from(document.querySelectorAll(selector));

    return all.filter(el => {
      // Exclude hidden or non-content elements
      if (el.closest("header, footer, nav, aside, pre, code, script, style, noscript, .brancy-web-trans, #brancy-floating-ball, #brancy-sidebar, .open-trancy-floating-ball, .open-trancy-sidebar")) {
        return false;
      }
      // Don't translate if already translated
      if (el.dataset.otTranslated === "true") {
        return false;
      }

      // If this element contains another candidate child, only translate the leaf child
      const hasCandidateChild = all.some(other => other !== el && el.contains(other));
      if (hasCandidateChild) {
        return false;
      }

      // Must be visible
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }

      // Check text content
      const text = el.innerText ? el.innerText.trim() : "";
      if (text.length < 5) return false;

      // Don't translate pure numbers or symbols
      if (/^[\d\s.,\/#!$%\^&\*;:{}=\-_`~()]+$/.test(text)) return false;

      return true;
    });
  }

  /**
   * Create sliding shimmer placeholder block
   */
  function createShimmerBlock(originalEl) {
    if (originalEl.dataset.otTranslated) return null;
    originalEl.dataset.otTranslated = "pending";

    const block = document.createElement("div");
    block.className = "brancy-web-trans ot-shimmer-loading";
    block.innerHTML = `
      <div class="ot-shimmer-content">
        <div class="ot-shimmer-bar ot-shimmer-bar-lg"></div>
        <div class="ot-shimmer-bar ot-shimmer-bar-sm"></div>
      </div>
      <div class="ot-shimmer-badge">
        <span class="ot-shimmer-sparkle">✨</span>
        <span>AI 翻譯中...</span>
      </div>
    `;

    // Insert as next sibling
    if (originalEl.nextSibling) {
      originalEl.parentNode.insertBefore(block, originalEl.nextSibling);
    } else {
      originalEl.parentNode.appendChild(block);
    }
    return block;
  }

  /**
   * Replace shimmer block with translated content smoothly
   */
  function resolveShimmerBlock(block, originalEl, translatedText) {
    if (!block) return;
    originalEl.dataset.otTranslated = "true";

    block.classList.remove("ot-shimmer-loading");
    block.classList.add("ot-trans-fade-in");
    block.innerHTML = `
      <div class="ot-web-trans-content">${BrancyUtils.escapeHtml(translatedText)}</div>
      <div class="ot-web-trans-tools">
        <button class="ot-trans-btn" data-action="speak" title="朗讀翻譯">🔊</button>
        <button class="ot-trans-btn" data-action="copy" title="複製翻譯">📋</button>
      </div>
    `;

    // Actions
    block.querySelector('[data-action="speak"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      BrancyUtils.speakText(translatedText, settings.targetLang === "zh-TW" ? "zh-TW" : "zh-CN");
    });

    block.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(translatedText);
      const btn = block.querySelector('[data-action="copy"]');
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = "📋"), 1500);
    });
  }

  function showToast(msg) {
    let toast = document.getElementById("brancy-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "brancy-toast";
      toast.className = "brancy-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3200);
  }

  // Expose global controller
  window.BrancyWebpage = {
    togglePageTranslation,
    translateCurrentPage,
    restoreOriginalPage
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
