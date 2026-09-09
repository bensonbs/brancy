# Brancy

黑白灰極簡風格的 Chrome 雙語翻譯擴充功能。原生 JavaScript、無前端框架、無須編譯。

## 使用方式

1. 在 `chrome://extensions` 開啟開發人員模式，選擇「載入未封裝項目」。
2. 選取本專案目錄。更新程式後，請在擴充功能管理頁按「重新載入」。
3. 在一般網頁按右鍵，選擇 **Brancy：翻譯網頁／還原原文**。再次選擇會移除譯文。

網頁翻譯僅由右鍵選單操作，沒有鍵盤快捷鍵。翻譯進行中也可再次選擇右鍵選單來停止並還原。

在 YouTube 觀看頁，右鍵翻譯會處理影片標題、說明及評論，不翻譯推薦影片、播放器與留言輸入區。譯文與簡短載入提示置於各則評論下方；捲動或展開回覆後，新載入的評論會接續翻譯，還原或切換影片後停止。

瀏覽器內部頁面、擴充功能商店等受限制頁面無法注入翻譯。對已開啟的一般網頁，右鍵操作會按需載入翻譯腳本。

## 翻譯引擎

- **Google 翻譯 · 免金鑰**：預設模式，透過 Google 網頁翻譯端點運作；非官方 Cloud API，服務可用性取決於 Google。
- **Google 翻譯 · 官方 API**：在設定中輸入 Google Cloud Translation API Key。
- **OpenRouter · 自訂模型**：選取 OpenRouter，點擊「取得 API Key」前往 [OpenRouter 金鑰頁](https://openrouter.ai/keys)，填入金鑰。模型預填 `deepseek/deepseek-v4-flash-0731`，可改成任意可用的完整模型 ID。

OpenRouter 使用串流回應，每次請求最多等待 60 秒，網頁翻譯每批最多 8 段，並依文字長度再拆分，以減少長文逾時。

設定自動儲存於此瀏覽器。OpenRouter 與 Google 官方 API 可按「測試連線」驗證；模型是否可用取決於 OpenRouter 與帳號權限。所選服務缺少金鑰或回傳錯誤時會顯示提示。

## 其他功能

- YouTube 雙語字幕依影片播放時間及原始字幕時間碼顯示；暫停凍結即時字幕、拖曳重新對齊，過期翻譯不會蓋回目前畫面。可調整字級、顏色、背景與原文順序。
- 劃詞翻譯與英文單字釋義，可隨時關閉。
- YouTube 字幕本機快取，可從面板或設定頁清除。
- YouTube 播放快捷鍵：`A` 上一句、`S` 重播、`D` 下一句、`E` 切換字幕。可在設定中關閉。

## 開發

`npm test` 執行 API 路由與右鍵選單測試。`npm install`、`npx playwright install chromium` 後，使用 `npm run test:ui` 執行瀏覽器介面與網頁翻譯流程測試，截圖輸出至 `artifacts/`。`npm run test:youtube` 另外驗證字幕同步、非同步回應順序與評論翻譯。API 測試使用模擬回應，不會消耗金鑰額度；擴充功能本身不需要安裝任何套件。

主要檔案：`popup/` 工具列面板、`options/` 設定頁、`styles/base.css` 共用樣式、`background/page-translation.js` 右鍵選單、`background/translator.js` 翻譯服務、`content/webpage/` 網頁雙語與劃詞、`content/youtube/` 影片字幕。

右鍵選單與動態載入依照 [Chrome contextMenus API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus) 與 [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)；翻譯串接參考 [Google Translation Basic](https://docs.cloud.google.com/translate/docs/basic/translating-text) 與 [OpenRouter Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request) 與 [串流協定](https://openrouter.ai/docs/api_reference/streaming)。
