/**
 * Brancy Selection & Hover Word Lookup (Trancy-style Quick Lookup)
 */

(function () {
  let popupEl = null;
  let settings = null;
  let selectionRevision = 0;

  async function init() {
    settings = await BrancyUtils.getSettings();
    createPopupElement();
    bindEvents();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.webSelectionEnabled) {
        settings.webSelectionEnabled = changes.webSelectionEnabled.newValue ?? true;
        if (!settings.webSelectionEnabled) hidePopup();
      }
    });
  }

  function createPopupElement() {
    if (document.getElementById("brancy-selection-popup")) return;

    popupEl = document.createElement("div");
    popupEl.id = "brancy-selection-popup";
    popupEl.className = "brancy-selection-popup hidden";
    document.body.appendChild(popupEl);
  }

  function bindEvents() {
    document.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;
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

    selectionRevision++;
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
      <div class="ot-popup-shimmer">
        <div class="ot-popup-shimmer-header">
          <span class="ot-shimmer-badge">
            <span>查詞翻譯中…</span>
          </span>
        </div>
        <div class="ot-shimmer-bar" style="width: 88%; height: 16px; margin: 8px 0 6px 0;"></div>
        <div class="ot-shimmer-bar" style="width: 60%; height: 13px;"></div>
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

  function selectionIsCurrent(revision) {
    return revision === selectionRevision && popupEl?.isConnected && !popupEl.classList.contains("hidden");
  }

  function appendStage(response) {
    const label = document.createElement("div");
    label.className = "brancy-translation-status";
    label.textContent = BrancyUtils.translationStageLabel(response.stages?.[0]) + (response.statuses?.[0] ? " · " + response.statuses[0] : "");
    label.style.display = label.textContent ? "" : "none";
    label.title = response.statuses?.[0] || "";
    popupEl.appendChild(label);
  }

  async function renderWordDetails(word) {
    const revision = selectionRevision;
    try {
      await BrancyUtils.translateProgressively({ action: "LOOKUP_WORD", word }, {
        isCurrent: () => selectionIsCurrent(revision),
        onUpdate: response => {
          if (!response?.success || !response.data) { renderError(response?.error || "查詞失敗"); return; }
          const data = response.data;
          const meanings = (data.meanings || []).map(meaning => `<div class="ot-popup-def"><span class="ot-popup-pos">${BrancyUtils.escapeHtml(meaning.partOfSpeech)}</span><span class="ot-popup-def-text">${BrancyUtils.escapeHtml(meaning.definition)}</span></div>`).join("");
          popupEl.innerHTML = `<div class="ot-popup-header"><div class="ot-popup-word">${BrancyUtils.escapeHtml(data.word)}</div><div class="ot-popup-phonetic">${BrancyUtils.escapeHtml(data.phonetic)}</div></div><div class="ot-popup-trans">${BrancyUtils.escapeHtml(data.translation)}</div>${meanings ? `<div class="ot-popup-meanings">${meanings}</div>` : ""}`;
          appendStage(response);
        }
      });
    } catch (error) { if (selectionIsCurrent(revision)) renderError(error.message); }
  }

  async function renderPhraseTranslation(text) {
    const revision = selectionRevision;
    try {
      await BrancyUtils.translateProgressively({ action: "TRANSLATE_TEXTS", texts: [text] }, {
        isCurrent: () => selectionIsCurrent(revision),
        onUpdate: response => {
          if (!response?.success || !response.data?.[0]) { renderError(response?.error || "翻譯失敗"); return; }
          popupEl.innerHTML = `<div class="ot-popup-header"><span class="ot-popup-label">Brancy 翻譯</span></div><div class="ot-popup-trans">${BrancyUtils.escapeHtml(response.data[0])}</div><div class="ot-popup-orig">${BrancyUtils.escapeHtml(text)}</div>`;
          appendStage(response);
        }
      });
    } catch (error) { if (selectionIsCurrent(revision)) renderError(error.message); }
  }

  function renderError(msg) {
    popupEl.innerHTML = `
      <div class="ot-popup-header">
        <span class="ot-popup-label">翻譯錯誤</span>
      </div>
      <div class="ot-popup-error">${BrancyUtils.escapeHtml(msg)}</div>
    `;
  }

  function hidePopup() {
    selectionRevision++;
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
