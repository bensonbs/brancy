/**
 * Brancy Options Page Controller
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Navigation
  const navItems = document.querySelectorAll(".ot-nav-item");
  const sections = document.querySelectorAll(".ot-section");

  navItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = item.getAttribute("data-target");
      navItems.forEach(n => n.classList.remove("active"));
      sections.forEach(s => s.classList.remove("active"));

      item.classList.add("active");
      document.getElementById(targetId)?.classList.add("active");
    });
  });

  // Inputs
  const optEngine = document.getElementById("opt-engine");
  const optTargetLang = document.getElementById("opt-target-lang");
  const optOpenRouterKey = document.getElementById("opt-openrouter-key");
  const optToggleKeyView = document.getElementById("opt-toggle-key-view");
  const optModelSelect = document.getElementById("opt-openrouter-model-select");
  const fieldCustomModel = document.getElementById("field-custom-model");
  const optCustomModel = document.getElementById("opt-custom-model");
  const optGoogleKey = document.getElementById("opt-google-key");

  // YouTube styles
  const optSubOrder = document.getElementById("opt-sub-order");
  const optFontSize = document.getElementById("opt-font-size");
  const valFontSize = document.getElementById("val-font-size");
  const optOriginFontSize = document.getElementById("opt-origin-font-size");
  const valOriginFontSize = document.getElementById("val-origin-font-size");
  const optSubColor = document.getElementById("opt-sub-color");
  const optSubBg = document.getElementById("opt-sub-bg");

  // Preview elements
  const previewBox = document.getElementById("ot-preview-box");
  const previewTarget = document.getElementById("ot-preview-target");
  const previewOrigin = document.getElementById("ot-preview-origin");

  // Web & Shortcuts
  const optWebSelection = document.getElementById("opt-web-selection");
  const optWebFloatingBall = document.getElementById("opt-web-floating-ball");
  const optShortcutsEnabled = document.getElementById("opt-shortcuts-enabled");

  // Buttons
  const testOpenRouterBtn = document.getElementById("opt-test-openrouter");
  const openRouterStatus = document.getElementById("opt-openrouter-test-result");
  const testGoogleBtn = document.getElementById("opt-test-google");
  const googleStatus = document.getElementById("opt-google-test-result");
  const clearCacheBtn = document.getElementById("opt-btn-clear-cache");
  const cacheStatus = document.getElementById("opt-cache-status");
  const resetAllBtn = document.getElementById("opt-btn-reset-all");
  const saveIndicator = document.getElementById("ot-save-indicator");

  // Load settings
  const resp = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
  let settings = resp?.settings || {};

  populateUI(settings);
  updatePreview();

  function populateUI(s) {
    optEngine.value = s.engine || "google_free";
    optTargetLang.value = s.targetLang || "zh-TW";
    optOpenRouterKey.value = s.openRouterKey || "";
    optGoogleKey.value = s.googleApiKey || "";

    // Model selection
    const standardModels = [
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat",
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-haiku",
      "meta-llama/llama-3.3-70b-instruct"
    ];
    if (standardModels.includes(s.openRouterModel)) {
      optModelSelect.value = s.openRouterModel;
      fieldCustomModel.classList.add("hidden");
    } else if (s.openRouterModel) {
      optModelSelect.value = "custom";
      optCustomModel.value = s.openRouterModel;
      fieldCustomModel.classList.remove("hidden");
    }

    optSubOrder.value = s.youtubePrimaryOrder || "target_first";
    optFontSize.value = s.youtubeFontSize || 20;
    valFontSize.textContent = `${optFontSize.value}px`;
    optOriginFontSize.value = s.youtubeOriginFontSize || 14;
    valOriginFontSize.textContent = `${optOriginFontSize.value}px`;
    optSubColor.value = s.youtubeSubColor || "#ffffff";
    optSubBg.value = s.youtubeSubBg || "rgba(0, 0, 0, 0.78)";

    optWebSelection.checked = !!s.webSelectionEnabled;
    optWebFloatingBall.checked = !!s.webFloatingBallEnabled;
    optShortcutsEnabled.checked = !!s.shortcutsEnabled;
  }

  function updatePreview() {
    if (!previewBox) return;
    previewBox.style.backgroundColor = optSubBg.value;
    previewTarget.style.fontSize = `${optFontSize.value}px`;
    previewTarget.style.color = optSubColor.value;
    previewOrigin.style.fontSize = `${optOriginFontSize.value}px`;
    previewBox.classList.toggle("origin-first", optSubOrder.value === "origin_first");
  }

  async function save() {
    let chosenModel = optModelSelect.value;
    if (chosenModel === "custom") {
      chosenModel = optCustomModel.value.trim() || "google/gemini-2.5-flash";
    }

    const updated = {
      engine: optEngine.value,
      targetLang: optTargetLang.value,
      openRouterKey: optOpenRouterKey.value.trim(),
      openRouterModel: chosenModel,
      googleApiKey: optGoogleKey.value.trim(),
      youtubePrimaryOrder: optSubOrder.value,
      youtubeFontSize: parseInt(optFontSize.value, 10),
      youtubeOriginFontSize: parseInt(optOriginFontSize.value, 10),
      youtubeSubColor: optSubColor.value,
      youtubeSubBg: optSubBg.value,
      webSelectionEnabled: optWebSelection.checked,
      webFloatingBallEnabled: optWebFloatingBall.checked,
      shortcutsEnabled: optShortcutsEnabled.checked
    };

    await chrome.runtime.sendMessage({
      action: "SAVE_SETTINGS",
      settings: updated
    });

    saveIndicator.style.opacity = "1";
    saveIndicator.textContent = "變更已自動儲存 ✓";
    setTimeout(() => {
      saveIndicator.style.opacity = "0.7";
    }, 1500);
  }

  // Bind inputs to save
  [optEngine, optTargetLang, optSubOrder, optSubBg, optWebSelection, optWebFloatingBall, optShortcutsEnabled].forEach(el => {
    el.addEventListener("change", () => {
      save();
      updatePreview();
    });
  });

  optOpenRouterKey.addEventListener("input", save);
  optGoogleKey.addEventListener("input", save);
  optCustomModel.addEventListener("input", save);

  optFontSize.addEventListener("input", () => {
    valFontSize.textContent = `${optFontSize.value}px`;
    updatePreview();
    save();
  });

  optOriginFontSize.addEventListener("input", () => {
    valOriginFontSize.textContent = `${optOriginFontSize.value}px`;
    updatePreview();
    save();
  });

  optSubColor.addEventListener("input", () => {
    updatePreview();
    save();
  });

  optModelSelect.addEventListener("change", () => {
    if (optModelSelect.value === "custom") {
      fieldCustomModel.classList.remove("hidden");
    } else {
      fieldCustomModel.classList.add("hidden");
    }
    save();
  });

  // Toggle key visibility
  optToggleKeyView.addEventListener("click", () => {
    if (optOpenRouterKey.type === "password") {
      optOpenRouterKey.type = "text";
      optToggleKeyView.textContent = "隱藏";
    } else {
      optOpenRouterKey.type = "password";
      optToggleKeyView.textContent = "顯示";
    }
  });

  // Test OpenRouter connection
  testOpenRouterBtn.addEventListener("click", async () => {
    const key = optOpenRouterKey.value.trim();
    if (!key) {
      openRouterStatus.className = "ot-test-status error";
      openRouterStatus.textContent = "請先輸入 OpenRouter API Key！";
      return;
    }

    let model = optModelSelect.value;
    if (model === "custom") model = optCustomModel.value.trim();

    openRouterStatus.className = "ot-test-status loading";
    openRouterStatus.textContent = "連線測試中...";

    const startTime = Date.now();
    const res = await chrome.runtime.sendMessage({
      action: "TEST_API_KEY",
      engine: "openrouter",
      key,
      model
    });
    const duration = Date.now() - startTime;

    if (res && res.success) {
      openRouterStatus.className = "ot-test-status success";
      openRouterStatus.textContent = `連線成功！回應時間: ${duration}ms (模型正常)`;
    } else {
      openRouterStatus.className = "ot-test-status error";
      openRouterStatus.textContent = `連線失敗: ${res?.error || "未知錯誤"}`;
    }
  });

  // Test Google Cloud connection
  testGoogleBtn.addEventListener("click", async () => {
    const key = optGoogleKey.value.trim();
    if (!key) {
      googleStatus.className = "ot-test-status error";
      googleStatus.textContent = "請先輸入 Google API Key！";
      return;
    }

    googleStatus.className = "ot-test-status loading";
    googleStatus.textContent = "連線測試中...";

    const res = await chrome.runtime.sendMessage({
      action: "TEST_API_KEY",
      engine: "google_api",
      key
    });

    if (res && res.success) {
      googleStatus.className = "ot-test-status success";
      googleStatus.textContent = "Google API 連線成功！";
    } else {
      googleStatus.className = "ot-test-status error";
      googleStatus.textContent = `失敗: ${res?.error || "金鑰無效"}`;
    }
  });

  // Clear cache
  clearCacheBtn.addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ action: "CLEAR_CACHE" });
    cacheStatus.className = "ot-test-status success";
    cacheStatus.textContent = `已清除 ${res?.count || 0} 筆本機快取！`;
    setTimeout(() => (cacheStatus.textContent = ""), 3000);
  });

  // Reset all settings
  resetAllBtn.addEventListener("click", async () => {
    if (confirm("確定要將所有 Brancy 設定恢復為預設值嗎？")) {
      await chrome.storage.local.clear();
      const def = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
      populateUI(def?.settings || {});
      updatePreview();
      alert("設定已恢復為原廠預設值！");
    }
  });
});
