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
  const optTargetLang = document.getElementById("opt-target-lang");
  const optOpenRouterKey = document.getElementById("opt-openrouter-key");
  const optToggleKeyView = document.getElementById("opt-toggle-key-view");
  const optCustomModel = document.getElementById("opt-custom-model");

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
  const optShortcutsEnabled = document.getElementById("opt-shortcuts-enabled");

  // Buttons
  const testOpenRouterBtn = document.getElementById("opt-test-openrouter");
  const openRouterStatus = document.getElementById("opt-openrouter-test-result");
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
    optTargetLang.value = s.targetLang || "zh-TW";
    optOpenRouterKey.value = s.openRouterKey || "";

    optCustomModel.value = s.openRouterModel ?? "deepseek/deepseek-v4-flash-0731";

    optSubOrder.value = s.youtubePrimaryOrder || "target_first";
    optFontSize.value = s.youtubeFontSize || 20;
    valFontSize.textContent = `${optFontSize.value}px`;
    optOriginFontSize.value = s.youtubeOriginFontSize || 14;
    valOriginFontSize.textContent = `${optOriginFontSize.value}px`;
    optSubColor.value = s.youtubeSubColor || "#ffffff";
    optSubBg.value = s.youtubeSubBg || "rgba(0, 0, 0, 0.75)";

    optWebSelection.checked = !!s.webSelectionEnabled;
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
    const updated = {
      targetLang: optTargetLang.value,
      openRouterKey: optOpenRouterKey.value.trim(),
      openRouterModel: optCustomModel.value.trim(),
      youtubePrimaryOrder: optSubOrder.value,
      youtubeFontSize: parseInt(optFontSize.value, 10),
      youtubeOriginFontSize: parseInt(optOriginFontSize.value, 10),
      youtubeSubColor: optSubColor.value,
      youtubeSubBg: optSubBg.value,
      webSelectionEnabled: optWebSelection.checked,
      shortcutsEnabled: optShortcutsEnabled.checked
    };

    try {
      const response = await chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings: updated });
      if (!response?.success) throw new Error(response?.error || "儲存失敗");
    } catch (error) {
      saveIndicator.textContent = `未儲存：${error.message}`;
      return;
    }

    saveIndicator.style.opacity = "1";
    saveIndicator.textContent = "變更已自動儲存 ✓";
    setTimeout(() => {
      saveIndicator.style.opacity = "0.7";
    }, 1500);
  }

  // Bind inputs to save
  [optTargetLang, optSubOrder, optSubBg, optWebSelection, optShortcutsEnabled].forEach(el => {
    el.addEventListener("change", () => {
      save();
        updatePreview();
    });
  });

  optOpenRouterKey.addEventListener("input", save);
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

  async function safeRequest(message) {
    try { return await chrome.runtime.sendMessage(message); }
    catch (error) { return { success: false, error: error.message }; }
  }

  // Test OpenRouter connection
  testOpenRouterBtn.addEventListener("click", async () => {
    const key = optOpenRouterKey.value.trim();
    if (!key) {
      openRouterStatus.className = "ot-test-status error";
      openRouterStatus.textContent = "請先輸入 OpenRouter API Key！";
      return;
    }

    const model = optCustomModel.value.trim();
    if (!model) {
      openRouterStatus.className = "ot-test-status error";
      openRouterStatus.textContent = "請先輸入模型名稱。";
      return;
    }

    testOpenRouterBtn.disabled = true;
    openRouterStatus.className = "ot-test-status loading";
    openRouterStatus.textContent = "連線測試中...";

    const startTime = Date.now();
    const res = await safeRequest({
      action: "TEST_API_KEY",
      key,
      model
    });
    testOpenRouterBtn.disabled = false;
    const duration = Date.now() - startTime;

    if (res && res.success) {
      openRouterStatus.className = "ot-test-status success";
      openRouterStatus.textContent = `連線成功！回應時間: ${duration}ms (模型正常)`;
    } else {
      openRouterStatus.className = "ot-test-status error";
      openRouterStatus.textContent = `連線失敗: ${res?.error || "未知錯誤"}`;
    }
  });

  // Clear cache
  clearCacheBtn.addEventListener("click", async () => {
    const res = await safeRequest({ action: "CLEAR_CACHE" });
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
