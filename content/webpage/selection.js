/**
 * OpenTrancy Selection & Hover Word Lookup (Trancy-style Quick Lookup)
 */

(function () {
  let popupEl = null;
  let settings = null;
  let lastSelectionText = "";

  async function init() {
    settings = await OpenTrancyUtils.getSettings();
    createPopupElement();
    bindEvents();
  }

  function createPopupElement() {
    if (document.getElementById("open-trancy-selection-popup")) return;

    popupEl = document.createElement("div");
    popupEl.id = "open-trancy-selection-popup";
    popupEl.className = "open-trancy-selection-popup hidden";
    document.body.appendChild(popupEl);
  }

  function bindEvents() {
    document.addEventListener("mouseup", (e) => {
      // Don't trigger if click inside our popup
      if (popupEl && popupEl.contains(e.target)) return;

      setTimeout(() => {
        handleSelection(e);
      }, 50);
    });

    document.addEventListener("mousedown", (e) => {
      if (popupEl && !popupEl.contains(e.target) && !popupEl.classList.contains("hidden")) {
        hidePopup();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && popupEl && !popupEl.classList.contains("hidden")) {
        hidePopup();
      }
    });
  }

  async function handleSelection(e) {
    if (!settings || !settings.webSelectionEnabled) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      return;
    }

    const text = sel.toString().trim();
    if (!text || text.length === 0 || text.length > 1500) {
      return;
    }

    lastSelectionText = text;
    const isSingleWord = /^[\w'’-]{1,40}$/i.test(text);

    // Get coordinates from selection range
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    showPopupLoading(rect);

    if (isSingleWord) {
      await renderWordDetails(text);
    } else {
      await renderPhraseTranslation(text);
    }
  }

  function showPopupLoading(rect) {
    if (!popupEl) return;

    popupEl.innerHTML = `
      <div class="ot-popup-loading">
        <span class="ot-popup-spinner"></span>
        <span>翻譯中...</span>
      </div>
    `;
    positionPopup(rect);
    popupEl.classList.remove("hidden");
  }

  function positionPopup(rect) {
    if (!popupEl) return;

    const popupWidth = 320;
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 8;

    // Boundary checks
    if (left + popupWidth > window.innerWidth) {
      left = Math.max(10, window.innerWidth - popupWidth - 20);
    }
    if (top + 200 > window.innerHeight + window.scrollY) {
      top = Math.max(10, rect.top + window.scrollY - 160);
    }

    popupEl.style.left = `${Math.max(10, left)}px`;
    popupEl.style.top = `${top}px`;
  }

  async function renderWordDetails(word) {
    try {
      const data = await OpenTrancyDict.lookupWord(word);
      if (!data) {
        await renderPhraseTranslation(word);
        return;
      }

      let meaningsHtml = "";
      if (data.meanings && data.meanings.length > 0) {
        meaningsHtml = data.meanings.map(m => `
          <div class="ot-popup-def">
            <span class="ot-popup-pos">${OpenTrancyUtils.escapeHtml(m.partOfSpeech)}</span>
            <span class="ot-popup-def-text">${OpenTrancyUtils.escapeHtml(m.definition)}</span>
          </div>
        `).join("");
      }

      popupEl.innerHTML = `
        <div class="ot-popup-header">
          <div class="ot-popup-word">${OpenTrancyUtils.escapeHtml(data.word)}</div>
          ${data.phonetic ? `<div class="ot-popup-phonetic">[${OpenTrancyUtils.escapeHtml(data.phonetic)}]</div>` : ""}
          <button class="ot-popup-btn" id="ot-popup-speak" title="朗讀">🔊</button>
          <button class="ot-popup-btn" id="ot-popup-copy" title="複製">📋</button>
        </div>
        <div class="ot-popup-trans">${OpenTrancyUtils.escapeHtml(data.translation || "")}</div>
        ${meaningsHtml ? `<div class="ot-popup-meanings">${meaningsHtml}</div>` : ""}
      `;

      bindPopupActions(data.word, data.translation);
    } catch (err) {
      renderError(err.message);
    }
  }

  async function renderPhraseTranslation(text) {
    try {
      const res = await OpenTrancyUtils.sendMessageToBackground({
        action: "TRANSLATE_TEXTS",
        texts: [text]
      });

      if (!res || !res.success || !res.data || !res.data[0]) {
        throw new Error(res?.error || "翻譯失敗");
      }

      const translation = res.data[0];

      popupEl.innerHTML = `
        <div class="ot-popup-header">
          <span class="ot-popup-label">OpenTrancy 翻譯</span>
          <button class="ot-popup-btn" id="ot-popup-speak" title="朗讀">🔊</button>
          <button class="ot-popup-btn" id="ot-popup-copy" title="複製">📋</button>
        </div>
        <div class="ot-popup-trans">${OpenTrancyUtils.escapeHtml(translation)}</div>
        <div class="ot-popup-orig">${OpenTrancyUtils.escapeHtml(text)}</div>
      `;

      bindPopupActions(text, translation);
    } catch (err) {
      renderError(err.message);
    }
  }

  function bindPopupActions(text, translation) {
    popupEl.querySelector("#ot-popup-speak")?.addEventListener("click", () => {
      OpenTrancyUtils.speakText(text);
    });

    popupEl.querySelector("#ot-popup-copy")?.addEventListener("click", () => {
      navigator.clipboard.writeText(`${text}\n${translation || ""}`);
      const btn = popupEl.querySelector("#ot-popup-copy");
      if (btn) {
        btn.textContent = "✓";
        setTimeout(() => (btn.textContent = "📋"), 1500);
      }
    });
  }

  function renderError(msg) {
    popupEl.innerHTML = `
      <div class="ot-popup-header">
        <span class="ot-popup-label" style="color: #f87171;">翻譯錯誤</span>
      </div>
      <div class="ot-popup-error">${OpenTrancyUtils.escapeHtml(msg)}</div>
    `;
  }

  function hidePopup() {
    if (popupEl) {
      popupEl.classList.add("hidden");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
