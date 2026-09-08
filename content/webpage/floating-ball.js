/**
 * Brancy Floating Action Ball on Webpages
 */

(function () {
  let ballEl = null;
  let menuEl = null;
  let settings = null;
  let isMenuOpen = false;

  async function init() {
    settings = await BrancyUtils.getSettings();
    if (!settings.webFloatingBallEnabled) return;

    createFloatingBall();
    bindEvents();
  }

  function createFloatingBall() {
    if (document.getElementById("brancy-floating-ball")) return;

    const wrapper = document.createElement("div");
    wrapper.id = "brancy-floating-ball";
    wrapper.className = "brancy-floating-ball";
    wrapper.innerHTML = `
      <div id="ot-ball-button" class="ot-ball-btn" title="Brancy 網頁翻譯">
        <span>B</span>
      </div>
      <div id="ot-ball-menu" class="ot-ball-menu hidden">
        <div class="ot-ball-menu-header">Brancy 雙語翻譯</div>
        <div class="ot-ball-menu-item" id="ot-ball-action-translate">
          <span class="ot-ball-menu-icon">🌐</span>
          <span id="ot-ball-trans-label">雙語翻譯整頁</span>
        </div>
        <div class="ot-ball-menu-item" id="ot-ball-action-engine">
          <span class="ot-ball-menu-icon">⚙️</span>
          <span id="ot-ball-engine-label">切換引擎</span>
        </div>
        <div class="ot-ball-menu-item" id="ot-ball-action-lang">
          <span class="ot-ball-menu-icon">🌍</span>
          <span id="ot-ball-lang-label">切換目標語言</span>
        </div>
        <div class="ot-ball-menu-divider"></div>
        <div class="ot-ball-menu-item" id="ot-ball-action-hide">
          <span class="ot-ball-menu-icon">✕</span>
          <span>隱藏懸浮小球</span>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);
    ballEl = wrapper.querySelector("#ot-ball-button");
    menuEl = wrapper.querySelector("#ot-ball-menu");
    updateMenuLabels();
  }

  function updateMenuLabels() {
    if (!settings) return;
    const isTranslated = document.body.classList.contains("ot-page-translated");
    const transLabel = document.getElementById("ot-ball-trans-label");
    if (transLabel) {
      transLabel.textContent = isTranslated ? "恢復原始網頁" : "雙語翻譯整頁";
    }

    const engineLabel = document.getElementById("ot-ball-engine-label");
    if (engineLabel) {
      const name = settings.engine === "openrouter" ? "OpenRouter AI" : "Google 免費端點";
      engineLabel.textContent = `引擎: ${name}`;
    }

    const langLabel = document.getElementById("ot-ball-lang-label");
    if (langLabel) {
      langLabel.textContent = `目標: ${settings.targetLang || "zh-TW"}`;
    }
  }

  function bindEvents() {
    ballEl.addEventListener("click", (e) => {
      e.stopPropagation();
      isMenuOpen = !isMenuOpen;
      menuEl.classList.toggle("hidden", !isMenuOpen);
      updateMenuLabels();
    });

    document.addEventListener("click", (e) => {
      if (menuEl && !menuEl.contains(e.target) && !ballEl.contains(e.target)) {
        isMenuOpen = false;
        menuEl.classList.add("hidden");
      }
    });

    // Translate action
    document.getElementById("ot-ball-action-translate")?.addEventListener("click", () => {
      isMenuOpen = false;
      menuEl.classList.add("hidden");
      if (window.BrancyWebpage) {
        window.BrancyWebpage.togglePageTranslation();
      }
      setTimeout(updateMenuLabels, 300);
    });

    // Toggle Engine action
    document.getElementById("ot-ball-action-engine")?.addEventListener("click", async () => {
      const nextEngine = settings.engine === "google_free" ? "openrouter" : "google_free";
      settings.engine = nextEngine;
      await BrancyUtils.saveSettings({ engine: nextEngine });
      updateMenuLabels();
    });

    // Toggle Lang action
    document.getElementById("ot-ball-action-lang")?.addEventListener("click", async () => {
      const langs = ["zh-TW", "zh-CN", "en", "ja"];
      const currIdx = langs.indexOf(settings.targetLang);
      const nextLang = langs[(currIdx + 1) % langs.length];
      settings.targetLang = nextLang;
      await BrancyUtils.saveSettings({ targetLang: nextLang });
      updateMenuLabels();
    });

    // Hide ball action
    document.getElementById("ot-ball-action-hide")?.addEventListener("click", async () => {
      const wrapper = document.getElementById("brancy-floating-ball");
      if (wrapper) wrapper.style.display = "none";
      await BrancyUtils.saveSettings({ webFloatingBallEnabled: false });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
