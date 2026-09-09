document.addEventListener("DOMContentLoaded", async () => {
  const $ = id => document.getElementById(id);
  const status = $("ot-status");
  function showStatus(text) { status.textContent = text; status.hidden = false; }
  async function request(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.success) throw new Error(response?.error || "無法讀取設定，請重新開啟 Brancy。");
    return response;
  }
  try {
    const { settings } = await request({ action: "GET_SETTINGS" });
    $("ot-lang-select").value = settings.targetLang;
    $("ot-sw-yt-subs").checked = settings.youtubeSubtitleEnabled;
    $("ot-sw-selection").checked = settings.webSelectionEnabled;
    function updateHint() {
      $("ot-current-model").textContent = settings.openRouterKey?.trim()
        ? "Google 先暫譯 → OpenRouter 自動補譯"
        : "Google 暫譯 · 設定 OpenRouter 後自動補譯";
    }
    updateHint();
    for (const [id, key, checkbox] of [
      ["ot-lang-select", "targetLang"],
      ["ot-sw-yt-subs", "youtubeSubtitleEnabled", true], ["ot-sw-selection", "webSelectionEnabled", true]
    ]) {
      $(id).addEventListener("change", async () => {
        try {
          await request({ action: "SAVE_SETTINGS", settings: { [key]: checkbox ? $(id).checked : $(id).value } });
          updateHint();
        } catch (error) { showStatus(error.message); }
      });
    }
  } catch (error) { showStatus(error.message); }
  for (const id of ["ot-open-options", "ot-link-to-keys", "ot-configure"]) {
    $(id).addEventListener("click", event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });
  }
  $("ot-clear-cache").addEventListener("click", async () => {
    try {
      const response = await request({ action: "CLEAR_CACHE" });
      showStatus(`已清除 ${response.count} 筆翻譯快取`);
    } catch (error) { showStatus(error.message); }
  });
});
