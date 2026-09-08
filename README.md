# OpenTrancy - 免費開源 AI 雙語網頁與 YouTube 翻譯擴充功能

> 🎯 **Trancy 完美開源平替方案**：無須每月訂閱付費，完整複製 Trancy 核心功能 —— **YouTube 雙語字幕、互動腳本側邊欄、單句循環練習、沉浸式網頁雙語翻譯與劃詞即時查詞**。支援 **Google 免費翻譯端點（免設定 Key）** 與 **OpenRouter AI（支援 Gemini 2.5 Flash、DeepSeek、Claude、GPT-4o mini 等主流大模型）**。

---

## ✨ 核心特色與功能一覽

### 1. 🎬 YouTube AI 雙語字幕播放器
- **雙語對照**：同時顯示目標語言（如繁體中文）與影片原始語言（如英文、日文）。
- **個人化樣式**：自訂字幕字級大小（14px - 32px）、字體顏色、背景透明度與文字陰影。
- **語系順序切換**：可選擇「翻譯在上，原文在下」或「原文在上，翻譯在下」。
- **無縫原生整合**：在 YouTube 播放器右下角控制列無縫注入控制開關（快捷鍵 `E` 切換顯示）。

### 2. 📖 YouTube 互動腳本側邊欄（Trancy 經典精讀模式）
- **時間戳記即時跳轉**：點擊任意字幕句子即可立刻跳轉影片至該時間點。
- **即時播放跟隨（Auto-scroll）**：隨影片播放自動高亮當前句子並平滑滾動，亦可一鍵鎖定自由瀏覽。
- **🔁 單句 A-B 循環複讀**：針對聽不清楚或練習口說的句子，一鍵啟動單句循環練習（Shadowing 影子跟讀神器）。
- **單字互動即時查詞**：游標點擊字幕中的任意單字，立刻彈出音標、詞性、釋義與朗讀發音。
- **台詞搜尋過濾**：內建即時搜尋欄，快速過濾全片關鍵台詞與單字。
- **匯出雙語字幕**：一鍵將全片雙語字幕匯出為 **SRT**、**VTT** 或 **TXT** 對照檔。

### 3. 🌐 網頁沉浸式雙語對照閱讀
- **全頁雙語閱讀**：按下快捷鍵 `Alt + T` 或點擊右下角懸浮按鈕，段落下方即刻生成優雅的雙語對照。
- **保持原始排版**：智慧識別文章段落，自動排除導航列、側邊欄、代碼區塊與頁尾。
- **段落快捷功能**：滑鼠懸浮至翻譯段落即可點擊「🔊 朗讀語音」或「📋 複製翻譯」。

### 4. 🔍 劃詞即時查詞與翻譯氣泡
- **智慧選詞識別**：選取網頁或字幕上的單字時，自動查詢音標、詞性與字典釋義。
- **長句翻譯**：選取長句或段落時，自動調用 AI 或 Google 進行雙語翻譯對照。
- **真人朗讀發音**：內建 Web Speech API 語音合成朗讀。

### 5. 🤖 多翻譯引擎自由切換
- **⚡ Google 免費翻譯端點（預設）**：零設定、零成本、無須 API Key，安裝後立刻使用！
- **🤖 OpenRouter AI**：填入使用者自己的 OpenRouter API Key，自由調用最先進的 LLM 大模型：
  - `google/gemini-2.5-flash`（推薦：極速、超高性價比、翻譯精確）
  - `deepseek/deepseek-chat`（推薦：中文翻譯極自然、語感極佳）
  - `openai/gpt-4o-mini`
  - `anthropic/claude-3.5-haiku`
  - 或自訂任何 OpenRouter 支援的模型！
- **🌐 Google Cloud Translation API**：支援自訂 Google Cloud 官方 API Key。
- **智慧本機記憶快取**：翻譯過的影片字幕與網頁文字自動儲存於瀏覽器本機，再次觀看時 0 秒加載，完全不重複消耗 API 額度。

---

## 🚀 安裝指南（Chrome / Edge / Brave / Arc）

本擴充功能採用 Chrome 最新 **Manifest V3** 原生規範開發，無須額外編譯，可直接載入：

1. 開啟 Chromium 核心瀏覽器（Google Chrome、Microsoft Edge、Brave 或 Arc）。
2. 在網址列輸入並前往擴充功能管理頁面：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
   - Brave：`brave://extensions`
3. 開啟右上角的 **「開發人員模式」（Developer mode）**。
4. 點擊左上角的 **「載入未打包項目」（Load unpacked）**。
5. 選擇資料夾路徑：
   ```
   /Users/benson/code/open-trancy
   ```
6. 點擊「選擇資料夾」，完成安裝！您可以在瀏覽器右上角擴充功能清單中看到 **OpenTrancy** 圖示。

---

## ⚙️ 設定 OpenRouter API Key

若您希望使用大模型（如 Gemini 2.5 Flash 或 DeepSeek）進行更高品質的 AI 翻譯：

1. 前往 [OpenRouter.ai/keys](https://openrouter.ai/keys) 註冊並建立一組 API Key。
2. 點擊瀏覽器右上角的 OpenTrancy 圖示，點擊右上角設定齒輪 ⚙️（或在圖示上按右鍵選擇「選項」）。
3. 在「API 金鑰與模型」分頁：
   - 翻譯引擎切換為：`🤖 OpenRouter AI`
   - 貼上您的 **OpenRouter API Key**。
   - 選擇偏好模型（推薦：`google/gemini-2.5-flash` 或 `deepseek/deepseek-chat`）。
   - 點擊「⚡ 測試 OpenRouter 連線」按鈕驗證。
4. 系統將自動儲存設定！

---

## ⌨️ 快捷鍵一覽表

在 YouTube 觀看影片時可直接使用下列快捷鍵（在留言區或輸入框打字時會自動忽略，不影響正常輸入）：

| 快捷鍵 | 功能 | 學習應用情境 |
| :---: | :--- | :--- |
| <kbd>A</kbd> | 跳轉至**上一句**字幕 | 回聽沒聽懂的前一句 |
| <kbd>S</kbd> | **重播當前這句**字幕 | 跟讀訓練、影子練習 (Shadowing) |
| <kbd>D</kbd> | 跳轉至**下一句**字幕 | 快速瀏覽練習 |
| <kbd>E</kbd> | 開啟 / 關閉雙語字幕覆蓋層 | 盲聽自我測驗 |
| <kbd>R</kbd> | 開啟 / 收起互動腳本側邊欄 | 全文閱讀與搜尋 |
| <kbd>Alt</kbd> + <kbd>T</kbd> | 開啟 / 關閉當前網頁沉浸式雙語翻譯 | 外語文章快速閱讀 |

---

## 📂 專案檔案架構

```
open-trancy/
├── manifest.json                  # Chrome Manifest V3 配置檔
├── icons/                         # 擴充功能圖示 (16x16, 48x48, 128x128)
├── background/
│   ├── background.js              # Service Worker 訊息調度中心
│   ├── translator.js              # Google 免費端點、Google API 與快取層
│   └── openrouter.js              # OpenRouter AI 大模型客戶端與批次提示詞
├── content/
│   ├── common/
│   │   ├── utils.js               # 時間格式化、設定儲存、防抖與語音合成
│   │   └── dict.js                # 單字切詞器與線上英漢辭典查詢
│   ├── youtube/
│   │   ├── youtube-page-bridge.js # MAIN world 腳本：讀取 YouTube 原生字幕軌
│   │   ├── youtube-captions.js    # 字幕下載、長句合併 (Sentence Segmentation)
│   │   ├── youtube-sidebar.js     # Trancy 風格側邊欄、A-B 循環、匯出 SRT/VTT
│   │   ├── youtube.js             # 播放器字幕渲染、YouTube 控制列按鈕與快捷鍵
│   │   └── youtube.css            # YouTube 雙語字幕與側邊欄深色主題樣式
│   └── webpage/
│       ├── webpage.js             # 沉浸式網頁雙語翻譯 (Alt+T)
│       ├── selection.js           # 劃詞即時查詞懸浮卡片
│       ├── floating-ball.js       # 網頁右下角快捷操作小球
│       └── webpage.css            # 網頁雙語對照排版與彈出氣泡樣式
├── popup/
│   ├── popup.html                 # 擴充功能彈出視窗 UI
│   ├── popup.js                   # 快捷開關控制
│   └── popup.css                  # 精緻現代暗色主題介面
└── options/
    ├── options.html               # 完整設定頁面 (API Key, 字體, 顏色, 預覽)
    ├── options.js                 # 設定管理與 API 連線測試
    └── options.css                # 雙欄式設定中心介面
```
