/**
 * Brancy Interactive Transcript Sidebar (Trancy-style Reading & Practice Mode)
 */

class YouTubeSidebar {
  constructor() {
    this.cues = [];
    this.currentCueIndex = -1;
    this.isOpen = false;
    this.isAutoScrollEnabled = true;
    this.loopCue = null;
    this.container = null;
    this.searchQuery = "";
    this.settings = null;
    this.tooltipEl = null;

    this.init();
  }

  async init() {
    this.settings = await BrancyUtils.getSettings();
    this.createSidebarElement();
    this.createWordTooltip();
    this.bindEvents();
  }

  createSidebarElement() {
    if (document.getElementById("brancy-sidebar")) return;

    const sidebar = document.createElement("div");
    sidebar.id = "brancy-sidebar";
    sidebar.className = "brancy-sidebar collapsed";
    sidebar.innerHTML = `
      <div class="ot-sidebar-header">
        <div class="ot-sidebar-title-group">
          <div class="ot-sidebar-logo">B</div>
          <div class="ot-sidebar-title">
            <span class="ot-main-title">Brancy 腳本</span>
            <span id="ot-cue-count" class="ot-badge">0 句</span>
          </div>
        </div>
        <div class="ot-sidebar-actions">
          <button id="ot-autoscroll-toggle" class="ot-btn-icon active" title="跟隨影片滾動 (點擊鎖定/解鎖)">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4v16m-6-6l6 6 6-6"/></svg>
          </button>
          <div class="ot-dropdown">
            <button id="ot-export-btn" class="ot-btn-icon" title="匯出雙語字幕">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            </button>
            <div id="ot-export-menu" class="ot-dropdown-menu hidden">
              <div class="ot-dropdown-item" data-export="srt">匯出雙語 SRT</div>
              <div class="ot-dropdown-item" data-export="vtt">匯出雙語 VTT</div>
              <div class="ot-dropdown-item" data-export="txt">匯出雙語對照 TXT</div>
            </div>
          </div>
          <button id="ot-sidebar-close" class="ot-btn-icon" title="收起側邊欄">✕</button>
        </div>
      </div>

      <div class="ot-sidebar-search-bar">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input type="text" id="ot-sidebar-search" placeholder="搜尋影片台詞或單字..." />
      </div>

      <div id="ot-sidebar-cue-list" class="ot-sidebar-cue-list">
        <div class="ot-sidebar-empty">正在載入影片字幕...</div>
      </div>

      <div id="ot-loop-banner" class="ot-loop-banner hidden">
        <span>🔁 單句循環練習中</span>
        <button id="ot-cancel-loop-btn">停止循環</button>
      </div>
    `;

    document.body.appendChild(sidebar);
    this.container = sidebar;
  }

  createWordTooltip() {
    if (document.getElementById("ot-word-tooltip")) return;
    const tooltip = document.createElement("div");
    tooltip.id = "ot-word-tooltip";
    tooltip.className = "ot-word-tooltip hidden";
    document.body.appendChild(tooltip);
    this.tooltipEl = tooltip;
  }

  bindEvents() {
    // Toggle close
    this.container.querySelector("#ot-sidebar-close").addEventListener("click", () => {
      this.toggle(false);
    });

    // Auto-scroll toggle
    const autoScrollBtn = this.container.querySelector("#ot-autoscroll-toggle");
    autoScrollBtn.addEventListener("click", () => {
      this.isAutoScrollEnabled = !this.isAutoScrollEnabled;
      autoScrollBtn.classList.toggle("active", this.isAutoScrollEnabled);
    });

    // Search filter
    const searchInput = this.container.querySelector("#ot-sidebar-search");
    searchInput.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderCues();
    });

    // Export dropdown
    const exportBtn = this.container.querySelector("#ot-export-btn");
    const exportMenu = this.container.querySelector("#ot-export-menu");
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => exportMenu.classList.add("hidden"));

    exportMenu.querySelectorAll(".ot-dropdown-item").forEach(item => {
      item.addEventListener("click", () => {
        const type = item.getAttribute("data-export");
        this.exportTranscript(type);
      });
    });

    // Cancel loop button
    this.container.querySelector("#ot-cancel-loop-btn").addEventListener("click", () => {
      this.setLoopCue(null);
    });

    // Subtitle events from captions manager
    window.addEventListener("brancy:cues-ready", (e) => {
      this.setCues(e.detail.cues);
    });

    window.addEventListener("brancy:translating-start", () => {
      const list = this.container.querySelector("#ot-sidebar-cue-list");
      list.innerHTML = `
        <div class="ot-sidebar-shimmer-wrap">
          <div class="ot-sidebar-shimmer-header">
            <span class="ot-shimmer-sparkle">✨</span>
            <span class="ot-shimmer-badge-text">AI 雙語字幕即時翻譯中...</span>
          </div>
          ${Array(6).fill(0).map(() => `
            <div class="ot-cue-item ot-shimmer-cue-row">
              <div class="ot-shimmer-bar" style="width: 32px; height: 14px; flex-shrink: 0;"></div>
              <div class="ot-cue-body" style="flex: 1;">
                <div class="ot-shimmer-bar" style="width: 82%; height: 14px; margin-bottom: 6px;"></div>
                <div class="ot-shimmer-bar" style="width: 58%; height: 12px;"></div>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    });

    window.addEventListener("brancy:no-captions", () => {
      const list = this.container.querySelector("#ot-sidebar-cue-list");
      list.innerHTML = `<div class="ot-sidebar-empty">此影片未提供字幕軌跡</div>`;
    });

    // Word click listener on transcript words
    this.container.addEventListener("click", async (e) => {
      const wordEl = e.target.closest(".ot-word");
      if (wordEl) {
        e.stopPropagation();
        const word = wordEl.getAttribute("data-word");
        this.showWordPopup(word, wordEl);
      }
    });

    document.addEventListener("click", (e) => {
      if (this.tooltipEl && !this.tooltipEl.contains(e.target)) {
        this.tooltipEl.classList.add("hidden");
      }
    });
  }

  async showWordPopup(word, targetEl) {
    if (!word || !this.tooltipEl) return;
    const rect = targetEl.getBoundingClientRect();
    this.tooltipEl.innerHTML = `
      <div class="ot-popup-shimmer">
        <div class="ot-shimmer-bar" style="width: 65%; height: 15px; margin-bottom: 6px;"></div>
        <div class="ot-shimmer-bar" style="width: 88%; height: 12px;"></div>
      </div>
    `;
    this.tooltipEl.classList.remove("hidden");
    this.tooltipEl.style.top = `${rect.bottom + window.scrollY + 6}px`;
    this.tooltipEl.style.left = `${Math.min(window.innerWidth - 260, Math.max(10, rect.left))}px`;

    const data = await BrancyDict.lookupWord(word);
    if (!data) {
      this.tooltipEl.innerHTML = `
        <div class="ot-tooltip-header">
          <span class="ot-tooltip-word">${BrancyUtils.escapeHtml(word)}</span>
        </div>
        <div class="ot-tooltip-trans">無法取得釋義</div>
      `;
      return;
    }

    let meaningsHtml = "";
    if (data.meanings && data.meanings.length > 0) {
      meaningsHtml = data.meanings.map(m => `
        <div class="ot-tooltip-def">
          <span class="ot-pos">${BrancyUtils.escapeHtml(m.partOfSpeech)}</span>
          <span class="ot-def-text">${BrancyUtils.escapeHtml(m.definition)}</span>
        </div>
      `).join("");
    }

    this.tooltipEl.innerHTML = `
      <div class="ot-tooltip-header">
        <span class="ot-tooltip-word">${BrancyUtils.escapeHtml(data.word)}</span>
        ${data.phonetic ? `<span class="ot-tooltip-phonetic">[${BrancyUtils.escapeHtml(data.phonetic)}]</span>` : ""}
        <button class="ot-tooltip-audio-btn" title="朗讀">🔊</button>
      </div>
      <div class="ot-tooltip-trans">${BrancyUtils.escapeHtml(data.translation || "")}</div>
      ${meaningsHtml ? `<div class="ot-tooltip-meanings">${meaningsHtml}</div>` : ""}
    `;

    this.tooltipEl.querySelector(".ot-tooltip-audio-btn")?.addEventListener("click", () => {
      BrancyUtils.speakText(data.word);
    });
  }

  setCues(cues) {
    this.cues = cues || [];
    this.currentCueIndex = -1;
    this.container.querySelector("#ot-cue-count").textContent = `${this.cues.length} 句`;
    this.renderCues();
  }

  renderCues() {
    const list = this.container.querySelector("#ot-sidebar-cue-list");
    if (!this.cues || this.cues.length === 0) {
      list.innerHTML = `<div class="ot-sidebar-empty">尚無字幕資料</div>`;
      return;
    }

    const filtered = this.cues.filter(c => {
      if (!this.searchQuery) return true;
      return c.text.toLowerCase().includes(this.searchQuery) ||
             (c.translation && c.translation.toLowerCase().includes(this.searchQuery));
    });

    if (filtered.length === 0) {
      list.innerHTML = `<div class="ot-sidebar-empty">沒有找到符合「${BrancyUtils.escapeHtml(this.searchQuery)}」的字幕</div>`;
      return;
    }

    list.innerHTML = filtered.map((cue) => {
      const isLooping = this.loopCue && this.loopCue.id === cue.id;
      const originalInteractive = BrancyDict.tokenizeTextToHtml(cue.text);
      return `
        <div class="ot-cue-item ${isLooping ? "looping" : ""}" data-id="${cue.id}">
          <div class="ot-cue-time" title="點擊跳轉">${BrancyUtils.formatTime(cue.start)}</div>
          <div class="ot-cue-body">
            <div class="ot-cue-text">${originalInteractive}</div>
            <div class="ot-cue-trans">${BrancyUtils.escapeHtml(cue.translation || "")}</div>
          </div>
          <div class="ot-cue-actions">
            <button class="ot-action-btn ot-btn-loop ${isLooping ? "active" : ""}" data-action="loop" title="單句循環">🔁</button>
            <button class="ot-action-btn" data-action="speak" title="朗讀原句">🔊</button>
            <button class="ot-action-btn" data-action="copy" title="複製原句與翻譯">📋</button>
          </div>
        </div>
      `;
    }).join("");

    // Bind item clicks
    list.querySelectorAll(".ot-cue-item").forEach(itemEl => {
      const id = parseInt(itemEl.getAttribute("data-id"), 10);
      const cue = this.cues.find(c => c.id === id);
      if (!cue) return;

      // Click to seek video
      itemEl.addEventListener("click", (e) => {
        if (e.target.closest(".ot-cue-actions") || e.target.closest(".ot-word")) return;
        this.seekVideo(cue.start);
      });

      // Actions
      itemEl.querySelector('[data-action="loop"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.loopCue && this.loopCue.id === cue.id) {
          this.setLoopCue(null);
        } else {
          this.setLoopCue(cue);
        }
      });

      itemEl.querySelector('[data-action="speak"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        BrancyUtils.speakText(cue.text);
      });

      itemEl.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(`${cue.text}\n${cue.translation || ""}`);
        const btn = itemEl.querySelector('[data-action="copy"]');
        btn.textContent = "✓";
        setTimeout(() => (btn.textContent = "📋"), 1500);
      });
    });
  }

  seekVideo(timeSec) {
    const video = document.querySelector("video");
    if (video) {
      video.currentTime = Math.max(0, timeSec);
      video.play();
    }
  }

  setLoopCue(cue) {
    this.loopCue = cue;
    const banner = this.container.querySelector("#ot-loop-banner");
    if (cue) {
      banner.classList.remove("hidden");
      this.seekVideo(cue.start);
    } else {
      banner.classList.add("hidden");
    }
    this.renderCues();
  }

  updateActiveTime(currentTime) {
    // Check loop condition
    if (this.loopCue) {
      if (currentTime >= this.loopCue.end || currentTime < this.loopCue.start) {
        this.seekVideo(this.loopCue.start);
        return;
      }
    }

    if (!this.cues || this.cues.length === 0) return;

    // Find active cue
    const activeIndex = this.cues.findIndex(c => currentTime >= c.start && currentTime <= c.end);
    if (activeIndex !== this.currentCueIndex) {
      this.currentCueIndex = activeIndex;
      this.highlightCue(activeIndex);
    }
  }

  highlightCue(index) {
    const list = this.container.querySelector("#ot-sidebar-cue-list");
    list.querySelectorAll(".ot-cue-item.active").forEach(el => el.classList.remove("active"));

    if (index === -1) return;
    const cue = this.cues[index];
    if (!cue) return;

    const targetEl = list.querySelector(`.ot-cue-item[data-id="${cue.id}"]`);
    if (targetEl) {
      targetEl.classList.add("active");
      if (this.isAutoScrollEnabled) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  toggle(show) {
    this.isOpen = typeof show === "boolean" ? show : !this.isOpen;
    if (this.container) {
      this.container.classList.toggle("collapsed", !this.isOpen);
    }
    // Adjust youtube player container width if needed
    window.dispatchEvent(new CustomEvent("brancy:sidebar-toggled", { detail: { isOpen: this.isOpen } }));
  }

  exportTranscript(type) {
    if (!this.cues || this.cues.length === 0) return;

    let content = "";
    let mime = "text/plain";
    let filename = `transcript_${Date.now()}`;

    if (type === "srt") {
      filename += ".srt";
      content = this.cues.map((c, i) => {
        const start = this.formatSrtTime(c.start);
        const end = this.formatSrtTime(c.end);
        return `${i + 1}\n${start} --> ${end}\n${c.text}\n${c.translation || ""}\n`;
      }).join("\n");
    } else if (type === "vtt") {
      filename += ".vtt";
      content = "WEBVTT\n\n" + this.cues.map((c, i) => {
        const start = this.formatVttTime(c.start);
        const end = this.formatVttTime(c.end);
        return `${i + 1}\n${start} --> ${end}\n${c.text}\n${c.translation || ""}\n`;
      }).join("\n");
    } else {
      // txt
      filename += ".txt";
      content = this.cues.map(c => `[${BrancyUtils.formatTime(c.start)}] ${c.text}\n${c.translation || ""}\n`).join("\n");
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  formatSrtTime(seconds) {
    const d = new Date(0);
    d.setUTCMilliseconds(Math.floor(seconds * 1000));
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
    return `${h}:${m}:${s},${ms}`;
  }

  formatVttTime(seconds) {
    return this.formatSrtTime(seconds).replace(",", ".");
  }
}

if (typeof window !== "undefined") {
  window.BrancySidebar = new YouTubeSidebar();
}
