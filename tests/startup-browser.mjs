import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const youtubeGroup = manifest.content_scripts.find(group => group.js.includes('content/youtube/youtube.js'));
const commonGroup = manifest.content_scripts.find(group => group.matches.includes('<all_urls>'));
assert.ok(youtubeGroup.js.indexOf('content/common/utils.js') < youtubeGroup.js.indexOf('content/youtube/youtube-captions.js'));
assert.ok(youtubeGroup.js.indexOf('content/youtube/youtube-captions.js') < youtubeGroup.js.indexOf('content/youtube/youtube.js'));
assert.deepEqual(commonGroup.exclude_matches, youtubeGroup.matches);
const files = ['content/common/utils.js', 'content/youtube/youtube-captions.js', 'content/youtube/youtube.js'];
const errors = [];
function observe(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('YouTube initialization failed')) errors.push(message.text());
  });
}
// Reverse loading order and duplicate injections reproduce dependency races,
// without substituting mocks for Brancy's common utilities or caption manager.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  observe(page);
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main>YouTube home fixture</main>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.settingListeners = [];
    window.chrome = { runtime: { id: 'test' }, storage: {
      local: { get(defaults, callback) { callback(defaults); } },
      onChanged: { addListener(fn) { settingListeners.push(fn); } }
    } };
  });
  // A previous injection's global lexical bindings must not block the utilities.
  await page.addScriptTag({ content: 'const DEFAULT_SETTINGS = { legacy: true };' });
  await page.addScriptTag({ path: resolve(root, files[2]) });
  assert.equal(await page.evaluate(() => BrancyYouTube.ready), null);
  await page.addScriptTag({ path: resolve(root, files[1]) });
  assert.equal(await page.evaluate(() => !!window.BrancyCaptions), false);
  await page.addScriptTag({ path: resolve(root, files[0]) });
  await page.evaluate(() => BrancyYouTube.ready);
  assert.equal(await page.evaluate(() => !!BrancyCaptions.__brancyReady && !!BrancyUtils.__brancyReady), true);
  const listenerCount = await page.evaluate(() => settingListeners.length);
  await page.evaluate(() => { window.originalUtils = BrancyUtils; window.originalCaptions = BrancyCaptions; window.originalReady = BrancyYouTube.ready; });
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const file of files) await page.addScriptTag({ path: resolve(root, file) });
  }
  assert.equal(await page.evaluate(() => originalUtils === BrancyUtils && originalCaptions === BrancyCaptions && originalReady === BrancyYouTube.ready), true);
  assert.equal(await page.evaluate(() => settingListeners.length), listenerCount);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

// Load the unpacked extension itself. This exercises Chrome's real manifest
// injection, isolated world and storage APIs, with no mocked chrome object.
const extension = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  let worker = extension.serviceWorkers()[0];
  if (!worker) worker = await extension.waitForEvent('serviceworker');
  const page = await extension.newPage();
  observe(page);
  await extension.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: 'text/html', body: '<main><div id="movie_player"><video class="html5-main-video"></video><div class="ytp-right-controls"></div></div></main>'
  }));
  await page.goto('https://www.youtube.com/');
  async function state() {
    return worker.evaluate(async () => {
      const tab = (await chrome.tabs.query({ url: 'https://www.youtube.com/*' }))[0];
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
        const ready = window.BrancyYouTube?.ready;
        if (ready) await ready;
        return { utils: !!window.BrancyUtils?.__brancyReady, captions: !!window.BrancyCaptions?.__brancyReady,
          renderer: !!ready, webpage: !!window.BrancyWebpage, overlays: document.querySelectorAll('#brancy-subtitles').length };
      } });
      return result.result;
    });
  }
  let homeState;
  for (let attempt = 0; attempt < 40; attempt++) {
    homeState = await state();
    if (homeState.renderer) break;
    await page.waitForTimeout(50);
  }
  assert.deepEqual(homeState, { utils: true, captions: true, renderer: true, webpage: true, overlays: 0 });
  await page.evaluate(() => {
    dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/watch?v=startup');
    dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.locator('#brancy-subtitles').waitFor({ state: 'attached' });
  await worker.evaluate(async files => {
    const tab = (await chrome.tabs.query({ url: 'https://www.youtube.com/*' }))[0];
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
  }, files);
  assert.deepEqual(await state(), { utils: true, captions: true, renderer: true, webpage: true, overlays: 1 });
  assert.deepEqual(errors, []);
  console.log('PASS: reverse dependency order, delayed utilities, legacy globals, duplicate injection, real unpacked-extension homepage startup and SPA watch navigation.');
} finally { await extension.close(); }
