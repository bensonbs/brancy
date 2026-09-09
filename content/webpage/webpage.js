/**
 * Brancy bilingual reading, controlled from the browser context menu.
 */

(function () {
  let isTranslating = false;
  let isPageTranslated = false;
  let settings = null;
  let translationRevision = 0;
  let pageSession = 0;
  let youtubeAutoEnabled = false;
  let youtubeObserver = null;
  let youtubeTimer = null;
  let youtubeHasPending = false;
  let processedYoutubeText = new WeakMap();
  let youtubeBlocks = new WeakMap();
  const isYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  const commentSelector = "ytd-comment-view-model #content-text, ytd-comment-renderer #content-text";
  const youtubeSelector = `${commentSelector}, #above-the-fold #title h1, #description-inline-expander #attributed-description, #description-inline-expander #attributed-snippet-text`;

  if (window.BrancyWebpage) return;

  // Register synchronously so freshly injected scripts are immediately ready.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "GET_PAGE_TRANSLATION_STATE") {
      sendResponse({ success: true, isTranslated: isPageTranslated, isTranslating });
    } else if (msg.action === "TOGGLE_PAGE_TRANSLATION") {
      togglePageTranslation().then(sendResponse).catch(error => {
        showToast(`翻譯失敗：${error.message}`);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
  });

  async function togglePageTranslation() {
    if (isTranslating || isPageTranslated || youtubeAutoEnabled) restoreOriginalPage();
    else {
      if (isYouTube) observeYouTubeComments();
      await translateCurrentPage();
    }
    return { success: true, isTranslated: isPageTranslated, isTranslating };
  }

  async function translateCurrentPage(announce = true) {
    if (isTranslating) { youtubeHasPending = true; return; }
    isTranslating = true;
    const revision = ++translationRevision;
    try { await translateCandidates(revision, announce); }
    finally {
      if (revision === translationRevision) {
        isTranslating = false;
        document.querySelectorAll(".brancy-web-trans.ot-shimmer-loading").forEach(el => el.remove());
        document.querySelectorAll("[data-ot-translated='pending']").forEach(el => delete el.dataset.otTranslated);
        if (youtubeAutoEnabled && youtubeHasPending) scheduleYouTubeComments();
      }
    }
  }

  function scheduleYouTubeComments() {
    youtubeHasPending = true;
    clearTimeout(youtubeTimer);
    youtubeTimer = setTimeout(() => {
      if (!youtubeAutoEnabled || isTranslating) return;
      youtubeHasPending = false;
      translateCurrentPage(false).catch(error => showToast(`翻譯失敗：${error.message}`));
    }, 250);
  }

  function observeYouTubeComments() {
    youtubeAutoEnabled = true;
    youtubeObserver?.disconnect();
    youtubeObserver = new MutationObserver(mutations => {
      // Ignore our own loading/translation nodes and unrelated player mutations.
      if (mutations.some(mutation => {
        const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (target?.closest(".brancy-web-trans")) return false;
        if (target?.closest(commentSelector)) return true;
        return Array.from(mutation.addedNodes).some(node => node.nodeType === 1 &&
          !node.matches(".brancy-web-trans") && (node.matches(commentSelector) || node.querySelector(commentSelector)));
      })) scheduleYouTubeComments();
    });
    youtubeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (isYouTube) window.addEventListener("yt-navigate-start", () => restoreOriginalPage(false));

  async function translateCandidates(revision, announce) {
    // Clean up any stale pending markers from aborted runs
    document.querySelectorAll("[data-ot-translated='pending']").forEach(el => {
      delete el.dataset.otTranslated;
    });

    if (announce) showToast("Brancy: 正在雙語翻譯網頁內容...");

    settings = await BrancyUtils.getSettings();
    if (revision !== translationRevision) return;

    // Collect candidate DOM elements
    const candidates = findTranslateCandidates();
    if (candidates.length === 0) {
      if (announce) showToast(isYouTube ? "尚無需要翻譯的內容。往下捲動載入評論後會自動翻譯。" : "未找到適合翻譯的文章段落");
      return;
    }

    const BATCH_SIZE = 20;
    const session = pageSession;
    let translatedCount = 0;
    let sameLangCount = 0;
    let failedCount = 0;
    let lastErrorMsg = null;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      if (revision !== translationRevision) return;
      if (announce) showToast(`正在翻譯 ${i + 1}–${Math.min(i + BATCH_SIZE, candidates.length)} / ${candidates.length} 段…`);
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const texts = batch.map(el => sourceText(el));

      // 1. Immediately inject shimmer skeleton placeholders for immediate visual feedback
      const shimmerBlocks = batch.map(el => createShimmerBlock(el));

      try {
        await BrancyUtils.translateProgressively({ action: "TRANSLATE_TEXTS", texts }, {
          isCurrent: () => session === pageSession && batch.some(el => el.isConnected),
          onUpdate: res => {
            if (!res?.success || !Array.isArray(res.data)) {
              lastErrorMsg = res?.error || "翻譯服務無回應";
              failedCount += batch.length;
              shimmerBlocks.forEach(block => block?.remove());
              batch.forEach(el => delete el.dataset.otTranslated);
              return;
            }
            batch.forEach((el, idx) => {
              const trans = res.data[idx];
              let block = shimmerBlocks[idx];
              const orig = texts[idx];
              if (!el.isConnected || sourceText(el) !== orig) {
                block?.remove();
                delete el.dataset.otTranslated;
                youtubeHasPending = true;
                return;
              }
              if (typeof trans !== "string" || !trans.trim()) {
                block?.remove(); delete el.dataset.otTranslated; failedCount++; return;
              }
              if (isYouTube) processedYoutubeText.set(el, orig);
              const different = trans.replace(/\s+/g, "").toLowerCase() !== orig.replace(/\s+/g, "").toLowerCase();
              if (different || res.stages?.[idx] === "pending") {
                if (!block?.isConnected) {
                  delete el.dataset.otTranslated;
                  block = shimmerBlocks[idx] = createShimmerBlock(el);
                }
                resolveShimmerBlock(block, el, trans, res.stages?.[idx], res.statuses?.[idx]);
                translatedCount++;
                isPageTranslated = true;
                document.body.classList.add("ot-page-translated");
              } else {
                sameLangCount++; block?.remove(); delete el.dataset.otTranslated;
              }
            });
          }
        });
      } catch (err) {
        if (revision !== translationRevision) return;
        lastErrorMsg = err.message;
        failedCount += batch.length;
        console.warn("[Brancy] Batch translation error:", err);
        shimmerBlocks.forEach(b => b && b.remove());
        batch.forEach(el => delete el.dataset.otTranslated);
      }
    }

    if (revision !== translationRevision) return;
    if (translatedCount > 0 || document.querySelector(".brancy-web-trans:not(.ot-shimmer-loading)")) {
      isPageTranslated = true;
      document.body.classList.add("ot-page-translated");
      if (announce) showToast(`Brancy: 完成 ${translatedCount} 段文字雙語翻譯！`);
    } else {
      isPageTranslated = false;
      document.body.classList.remove("ot-page-translated");

      if (lastErrorMsg) {
        youtubeAutoEnabled = false;
        youtubeObserver?.disconnect();
        showToast(`Brancy 翻譯失敗: ${lastErrorMsg}`);
      } else if (failedCount > 0) {
        showToast("Brancy: 翻譯服務暫時無回應，請檢查網路連線或金鑰設定！");
      } else if (!announce) {
        return;
      } else if (sameLangCount > 0) {
        showToast("Brancy: 本頁面內容已是目標語言（或無需翻譯），未檢測到外語段落");
      } else {
        showToast("Brancy: 未能找到需要翻譯的外語段落");
      }
    }
  }

  function restoreOriginalPage(announce = true) {
    translationRevision++;
    pageSession++;
    isTranslating = false;
    youtubeAutoEnabled = false;
    youtubeHasPending = false;
    youtubeObserver?.disconnect();
    clearTimeout(youtubeTimer);
    processedYoutubeText = new WeakMap();
    youtubeBlocks = new WeakMap();
    document.querySelectorAll(".brancy-web-trans").forEach(el => el.remove());
    document.querySelectorAll("[data-ot-translated]").forEach(el => delete el.dataset.otTranslated);
    document.querySelectorAll(".brancy-hf-discussion-row").forEach(el => el.classList.remove("brancy-hf-discussion-row"));
    document.body.classList.remove("ot-page-translated");
    isPageTranslated = false;
    if (announce) showToast("Brancy: 已還原原始網頁");
  }

  function sourceText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".brancy-web-trans, script, style, [hidden]").forEach(node => node.remove());
    clone.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
    return clone.textContent.replace(/\s+/g, " ").trim();
  }

  function findTranslateCandidates() {
    const selector = isYouTube ? youtubeSelector : "p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, article p, section p, .article-content p, .post-content p, .entry-content p, .rte p, .article__content p";
    const all = Array.from(document.querySelectorAll(selector));

    return all.filter(el => {
      // Exclude hidden or non-content elements
      if (el.closest("header, footer, nav, aside, pre, code, script, style, noscript, [contenteditable]:not([contenteditable='false']), [hidden], #brancy-selection-popup, #brancy-toast, .brancy-subtitles, .brancy-web-trans, #brancy-floating-ball, #brancy-sidebar, .open-trancy-floating-ball, .open-trancy-sidebar")) {
        return false;
      }
      if (isYouTube) {
        const processed = processedYoutubeText.get(el);
        if (processed === sourceText(el)) return false;
        if (processed !== undefined) {
          youtubeBlocks.get(el)?.remove();
          delete el.dataset.otTranslated;
        }
      }
      // Don't translate if already translated
      if (el.dataset.otTranslated === "true") {
        return false;
      }

      // If this element contains another candidate child, only translate the leaf child
      const hasCandidateChild = el.querySelector(selector) !== null;
      if (hasCandidateChild) {
        return false;
      }

      // Must be visible
      const style = window.getComputedStyle(el);
      if (!el.getClientRects().length || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }

      // Check text content
      const text = el.innerText ? sourceText(el) : "";
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
        <span>翻譯中…</span>
      </div>
    `;

    if (isYouTube) {
      block.classList.add("brancy-youtube-trans");
      block.textContent = "翻譯中…";
      // Place outside the clipped comment expander, inside the comment's main
      // column, so loading and translated text stay below the correct comment.
      const anchor = originalEl.closest("ytd-expander") || originalEl;
      anchor.insertAdjacentElement("afterend", block);
      youtubeBlocks.set(originalEl, block);
      return block;
    }

    // Hugging Face discussion cards have a fixed height and bottom-positioned
    // author metadata. Let just these translated cards grow with their text.
    if (location.hostname === "huggingface.co" && /^H[1-6]$/.test(originalEl.tagName)) {
      const link = originalEl.closest("a[href]");
      const row = link?.parentElement;
      if (link && /\/discussions\/\d+\/?$/.test(new URL(link.href).pathname) &&
          row && getComputedStyle(row).position === "relative" &&
          Array.from(row.children).some(el => el !== link && getComputedStyle(el).position === "absolute")) {
        row.classList.add("brancy-hf-discussion-row");
        block.classList.add("brancy-hf-discussion-trans");
      }
    }

    // For list items, append inside <li> to maintain clean list structure and not disrupt <ol> numbering
    if (originalEl.tagName === "LI") {
      originalEl.appendChild(block);
    } else if (originalEl.nextSibling) {
      originalEl.parentNode.insertBefore(block, originalEl.nextSibling);
    } else {
      originalEl.parentNode.appendChild(block);
    }
    return block;
  }

  /**
   * Replace shimmer block with translated content smoothly
   */
  function resolveShimmerBlock(block, originalEl, translatedText, stage = "google", status = "") {
    if (!block) return;
    originalEl.dataset.otTranslated = "true";

    block.classList.remove("ot-shimmer-loading");
    block.classList.add("ot-trans-fade-in");
    block.innerHTML = `<div class="ot-web-trans-content">${BrancyUtils.escapeHtml(translatedText)}</div><div class="brancy-translation-status" role="status"></div>`;
    const label = block.querySelector(".brancy-translation-status");
    label.textContent = BrancyUtils.translationStageLabel(stage) + (status ? " · 補譯未完成" : "");
    label.style.display = label.textContent ? "" : "none";
    label.title = status;
    block.dataset.translationStage = stage;
  }

  let toastTimer;
  function showToast(msg) {
    let toast = document.getElementById("brancy-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "brancy-toast";
      toast.className = "brancy-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3200);
  }

  // Expose global controller
  window.BrancyWebpage = {
    togglePageTranslation,
    translateCurrentPage,
    restoreOriginalPage
  };

})();
