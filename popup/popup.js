/**
 * OpenTrancy Popup Controller
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Elements
  const engineSelect = document.getElementById("ot-engine-select");
  const langSelect = document.getElementById("ot-lang-select");
  const openRouterHint = document.getElementById("ot-openrouter-hint");
  const currentModelSpan = document.getElementById("ot-current-model");
  const linkToKeys = document.getElementById("ot-link-to-keys");
  const openOptionsBtn = document.getElementById("ot-open-options");
  const translatePageBtn = document.getElementById("ot-btn-translate-page");
  const clearCacheBtn = document.getElementById("ot-clear-cache");

  // Switches
  const swYtSubs = document.getElementById("ot-sw-yt-subs");
  const swYtSidebar = document.getElementById("ot-sw-yt-sidebar");
  const swSelection = document.getElementById("ot-sw-selection");
  const swFloatingBall = document.getElementById("ot-sw-floating-ball");

  // Load current settings
  const resp = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
  const settings = resp?.settings || {};

  // Populate UI
  engineSelect.value = settings.engine || "google_free";
  langSelect.value = settings.targetLang || "zh-TW";
  swYtSubs.checked = !!settings.youtubeSubtitleEnabled;
  swYtSidebar.checked = !!settings.youtubeSidebarEnabled;
  swSelection.checked = !!settings.webSelectionEnabled;
  swFloatingBall.checked = !!settings.webFloatingBallEnabled;

  updateOpenRouterHint();

  function updateOpenRouterHint() {
    if (engineSelect.value === "openrouter") {
      openRouterHint.classList.remove("hidden");
      currentModelSpan.textContent = `模型: ${settings.openRouterModel || "google/gemini-2.5-flash"}`;
    } else {
      openRouterHint.classList.add("hidden");
    }
  }

  // Save changes helper
  async function updateSetting(key, val) {
    settings[key] = val;
    await chrome.runtime.sendMessage({
      action: "SAVE_SETTINGS",
      settings: { [key]: val }
    });
  }

  // Event Listeners
  engineSelect.addEventListener("change", () => {
    updateSetting("engine", engineSelect.value);
    updateOpenRouterHint();
  });

  langSelect.addEventListener("change", () => {
    updateSetting("targetLang", langSelect.value);
  });

  swYtSubs.addEventListener("change", () => {
    updateSetting("youtubeSubtitleEnabled", swYtSubs.checked);
  });

  swYtSidebar.addEventListener("change", () => {
    updateSetting("youtubeSidebarEnabled", swYtSidebar.checked);
  });

  swSelection.addEventListener("change", () => {
    updateSetting("webSelectionEnabled", swSelection.checked);
  });

  swFloatingBall.addEventListener("change", () => {
    updateSetting("webFloatingBallEnabled", swFloatingBall.checked);
  });

  // Open Options Page
  const goToOptions = (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options/options.html"));
    }
  };
  openOptionsBtn.addEventListener("click", goToOptions);
  linkToKeys.addEventListener("click", goToOptions);

  // Translate Current Tab
  translatePageBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      const pageResp = await chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_PAGE_TRANSLATION" });
      const label = document.getElementById("ot-page-btn-text");
      if (label) {
        label.textContent = pageResp?.isTranslated ? "已翻譯整頁 (再次點擊復原)" : "雙語翻譯當前網頁 (Alt+T)";
      }
    } catch (e) {
      alert("無法在當前分頁執行翻譯（可能是特殊系統頁面或尚未重新整理）。請重新整理該頁面後再試！");
    }
  });

  // Clear cache
  clearCacheBtn.addEventListener("click", async () => {
    if (confirm("確定要清除所有已快取的影片字幕與網頁翻譯嗎？")) {
      const res = await chrome.runtime.sendMessage({ action: "CLEAR_CACHE" });
      alert(`已成功清除 ${res?.count || 0} 筆快取資料！`);
    }
  });
});
