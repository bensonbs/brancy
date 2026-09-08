/**
 * Brancy Immersive Webpage Bilingual Translation
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
    showToast("Brancy: 正在雙語翻譯網頁內容...");

    settings = await BrancyUtils.getSettings();

    // Collect candidate DOM elements
    const candidates = findTranslateCandidates();
    if (candidates.length === 0) {
      showToast("Brancy: 未找到適合翻譯的段落");
      isTranslating = false;
      return;
    }

    const BATCH_SIZE = 20;
    let translatedCount = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const texts = batch.map(el => el.innerText.trim());

      try {
        const res = await BrancyUtils.sendMessageToBackground({
          action: "TRANSLATE_TEXTS",
          texts
        });

        if (res && res.success && res.data) {
          batch.forEach((el, idx) => {
            const trans = res.data[idx];
            if (trans && trans !== el.innerText.trim()) {
              injectTranslationBlock(el, trans);
              translatedCount++;
            }
          });
        }
      } catch (err) {
        console.warn("[Brancy] Batch translation error:", err);
      }
    }

    isTranslating = false;
    isPageTranslated = true;
    document.body.classList.add("ot-page-translated");
    showToast(`Brancy: 完成 ${translatedCount} 段文字雙語翻譯！`);
  }

  function restoreOriginalPage() {
    document.querySelectorAll(".brancy-web-trans").forEach(el => el.remove());
    document.body.classList.remove("ot-page-translated");
    isPageTranslated = false;
    showToast("Brancy: 已還原原始網頁");
  }

  function findTranslateCandidates() {
    const selector = "p, h1, h2, h3, h4, h5, h6, li, blockquote, article dd, article dt";
    const all = Array.from(document.querySelectorAll(selector));

    return all.filter(el => {
      // Exclude hidden or non-content elements
      if (el.closest("header, footer, nav, aside, pre, code, script, style, noscript, .brancy-web-trans, #brancy-floating-ball, #brancy-sidebar")) {
        return false;
      }
      if (el.dataset.otTranslated) {
        return false;
      }
      // Must be visible
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      // Check text content
      const text = el.innerText ? el.innerText.trim() : "";
      if (text.length < 8) return false;
      // Don't translate pure numbers or code
      if (/^[\d\s.,\/#!$%\^&\*;:{}=\-_`~()]+$/.test(text)) return false;

      return true;
    });
  }

  function injectTranslationBlock(originalEl, translatedText) {
    if (originalEl.dataset.otTranslated) return;
    originalEl.dataset.otTranslated = "true";

    const block = document.createElement("div");
    block.className = "brancy-web-trans";
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

    // Insert as next sibling
    if (originalEl.nextSibling) {
      originalEl.parentNode.insertBefore(block, originalEl.nextSibling);
    } else {
      originalEl.parentNode.appendChild(block);
    }
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
    }, 2800);
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
