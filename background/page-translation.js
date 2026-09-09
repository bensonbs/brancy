const MENU_ID = "brancy-translate-page";

export async function registerPageMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Brancy：翻譯網頁／還原原文",
    contexts: ["page", "selection", "link", "image", "video", "audio"],
    documentUrlPatterns: ["http://*/*", "https://*/*"]
  });
}

export async function toggleTabTranslation(tabId) {
  // Probe before sending the action: retrying an action could toggle it twice.
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: "GET_PAGE_TRANSLATION_STATE" }, { frameId: 0 });
    if (!response?.success) throw new Error("Content script unavailable");
  } catch {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.BrancyUtils)
    });
    if (!result?.result) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content/common/utils.js"] });
    }
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content/webpage/webpage.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/webpage/webpage.js"] });
  }
  return chrome.tabs.sendMessage(tabId, { action: "TOGGLE_PAGE_TRANSLATION" }, { frameId: 0 });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  toggleTabTranslation(tab.id).then(async response => {
    if (!response?.success) throw new Error(response?.error || "翻譯未完成");
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: "Brancy 雙語翻譯" });
  }).catch(async error => {
    console.warn("[Brancy] Page translation:", error.message);
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#333333" });
      await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
      await chrome.action.setTitle({ tabId: tab.id, title: `Brancy：${error.message}。若為受限制頁面，請改用一般網頁。` });
    } catch { /* The tab may have closed during translation. */ }
  });
});
