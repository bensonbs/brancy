import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const content = await readFile(path);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[extname(path)] || 'text/plain');
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
await mkdir(resolve(root, 'artifacts'), { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 920 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const defaults = { engine: 'google_free', targetLang: 'zh-TW', openRouterModel: 'deepseek/deepseek-v4-flash-0731', openRouterKey: '', googleApiKey: '', youtubeSubtitleEnabled: true, webSelectionEnabled: true, shortcutsEnabled: true, youtubeSubBg: 'rgba(0, 0, 0, 0.75)' };
    const stored = () => ({ ...defaults, ...JSON.parse(localStorage.getItem('settings') || '{}') });
    window.chrome = {
      runtime: {
        async sendMessage(msg) {
          if (msg.action === 'GET_SETTINGS') return { success: true, settings: stored() };
          if (msg.action === 'SAVE_SETTINGS') localStorage.setItem('settings', JSON.stringify({ ...stored(), ...msg.settings }));
          return { success: true, count: 2 };
        },
        openOptionsPage() { window.optionsOpened = true; }
      },
      storage: { local: { async clear() { localStorage.removeItem('settings'); } } }
    };
  });
  await page.goto(url + '/options/options.html');
  await page.waitForFunction(() => document.querySelector('#opt-custom-model').value === 'deepseek/deepseek-v4-flash-0731');
  assert.equal(await page.locator('#opt-engine, #card-google, #opt-google-key').count(), 0);
  assert.equal(await page.locator('#card-openrouter').isVisible(), true);
  assert.equal(await page.inputValue('#opt-custom-model'), 'deepseek/deepseek-v4-flash-0731');
  assert.equal(await page.getByRole('link', { name: '取得 API Key' }).getAttribute('href'), 'https://openrouter.ai/keys');
  assert.equal(await page.getByRole('link', { name: '取得 API Key' }).getAttribute('target'), '_blank');
  await page.click('#opt-test-openrouter');
  assert.match(await page.textContent('#opt-openrouter-test-result'), /API Key/);
  await page.screenshot({ path: resolve(root, 'artifacts/settings-openrouter.png'), fullPage: true, animations: "disabled" });
  await page.fill('#opt-custom-model', 'vendor/my-custom-model');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#opt-custom-model').value === 'vendor/my-custom-model');
  await page.fill('#opt-custom-model', 'deepseek/deepseek-v4-flash-0731');
  for (const id of ['section-youtube', 'section-web', 'section-shortcuts', 'section-data']) {
    await page.locator(`[data-target="${id}"]`).click();
    assert.equal(await page.locator(`#${id}`).isVisible(), true);
  }
  await page.locator('[data-target="section-api"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: resolve(root, 'artifacts/settings-mobile.png'), fullPage: true, animations: "disabled" });
  await page.goto(url + '/popup/popup.html');
  await page.waitForFunction(() => document.querySelector('#ot-current-model').hidden);
  assert.equal(await page.locator('#ot-engine-select').count(), 0);
  assert.equal(await page.isChecked('#ot-sw-yt-subs'), true);
  assert.equal(await page.isChecked('#ot-sw-selection'), true);
  await page.setViewportSize({ width: 344, height: 660 });
  await page.screenshot({ path: resolve(root, 'artifacts/popup.png'), fullPage: true, animations: "disabled" });
  await page.click('#ot-configure');
  assert.equal(await page.evaluate(() => window.optionsOpened), true);
  await page.click('#ot-clear-cache');
  assert.match(await page.textContent('#ot-status'), /2/);

  // Exercise the real content script in a rendered page with deterministic translations.
  await page.setViewportSize({ width: 900, height: 700 });
  await page.setContent('<article><h1>Read at your own pace</h1><p>The world feels a little closer when we understand one another.</p><ul><li>A sentence inside a list item.</li></ul><div hidden><p>This must stay untouched.</p></div><div contenteditable="true"><p>Do not translate my draft.</p></div></article><aside><p>Do not translate navigation.</p></aside>');
  await page.addStyleTag({ content: 'body { margin: 70px auto; max-width: 640px; font: 18px/1.7 sans-serif; color: #222; }' });
  await page.addStyleTag({ path: resolve(root, 'content/webpage/webpage.css') });
  await page.evaluate(() => {
    window.handlers = [];
    window.requestCount = 0;
    chrome.runtime.onMessage = { addListener(fn) { handlers.push(fn); } };
    window.BrancyUtils = {
      translationStageLabel(stage) { return stage === 'openrouter' ? 'OpenRouter' : 'Google 暫譯'; },
      async translateProgressively(message, { onUpdate, isCurrent = () => true }) {
        const response = await this.sendMessageToBackground(message);
        if (isCurrent()) onUpdate({ ...response, stages: (message.texts || message.cues || [message.word]).map(() => 'google'), statuses: [] });
        return response;
      },
      async getSettings() { return { engine: 'google_free' }; },
      async sendMessageToBackground(msg) {
        requestCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return window.failTranslation ? { success: false, error: '網路測試錯誤' } : { success: true, data: msg.texts.map((_, i) => ['用自己的步調閱讀', '當我們理解彼此，世界就更靠近了一點。', '清單中的一句話。'][i]) };
      },
      escapeHtml(text) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    };
    window.command = action => new Promise(resolve => handlers[0]({ action }, {}, resolve));
  });
  await page.addScriptTag({ path: resolve(root, 'content/webpage/webpage.js') });
  await page.addScriptTag({ path: resolve(root, 'content/webpage/webpage.js') });
  assert.equal(await page.evaluate(() => handlers.length), 1);
  await page.keyboard.press('Alt+t');
  assert.equal(await page.evaluate(() => requestCount), 0);
  const state = await page.evaluate(() => command('TOGGLE_PAGE_TRANSLATION'));
  assert.equal(state.isTranslated, true);
  assert.equal(await page.locator('.brancy-web-trans').count(), 3);
  assert.equal(await page.locator('li > .brancy-web-trans').count(), 1);
  assert.equal(await page.locator('[hidden] .brancy-web-trans, [contenteditable] .brancy-web-trans, aside .brancy-web-trans').count(), 0);
  await page.screenshot({ path: resolve(root, 'artifacts/translated-page.png'), fullPage: true, animations: "disabled" });
  assert.equal((await page.evaluate(() => command('TOGGLE_PAGE_TRANSLATION'))).isTranslated, false);
  assert.equal(await page.locator('.brancy-web-trans, [data-ot-translated]').count(), 0);
  await page.evaluate(() => { window.failTranslation = true; });
  await page.evaluate(() => command('TOGGLE_PAGE_TRANSLATION'));
  assert.match(await page.textContent('#brancy-toast'), /網路測試錯誤/);
  assert.equal(await page.locator('.ot-shimmer-loading, [data-ot-translated]').count(), 0);
  await page.evaluate(() => { window.failTranslation = false; });
  assert.equal((await page.evaluate(() => command('TOGGLE_PAGE_TRANSLATION'))).isTranslated, true);
  assert.deepEqual(errors, []);
  console.log('PASS: popup/settings rendering, model persistence, API-key link, responsive layout, context-message translation/restore, reinjection, failure/retry, and no page shortcut.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
