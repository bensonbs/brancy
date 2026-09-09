import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="movie_player"><video class="html5-main-video"></video><span class="ytp-caption-segment"></span><div class="ytp-right-controls"></div></div>' }));
  await page.goto('https://www.youtube.com/watch?v=rolling');
  await page.evaluate(() => {
    window.requests = [];
    window.media = { currentTime: 0, paused: false, seeking: false };
    window.video = document.querySelector('video');
    for (const key of Object.keys(media)) Object.defineProperty(video, key, { get: () => media[key] });
    window.chrome = {
      runtime: { id: 'test', sendMessage(message, callback) { requests.push({ message, callback }); } },
      storage: { local: { get(defaults, callback) { callback(defaults); } }, onChanged: { addListener() {} } }
    };
    window.BrancyCaptions = { fetchCaptionsForCurrentVideo() {} };
    window.caption = text => { document.querySelector('.ytp-caption-segment').textContent = text; };
    window.reply = (index, text, refine = true) => requests[index].callback({ success: true, data: [text],
      refinement: refine ? { targetLang: 'zh-TW', model: 'custom' } : null });
  });
  await page.addScriptTag({ path: resolve(root, 'content/common/utils.js') });
  await page.addScriptTag({ path: resolve(root, 'content/youtube/youtube.js') });
  await page.evaluate(() => caption('We generated'));
  await page.waitForFunction(() => requests.length === 1);
  await page.evaluate(() => caption('We generated the next step.'));
  await page.waitForFunction(() => requests.length === 2);
  await page.evaluate(() => caption('We generated the next step. Astra simply'));
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => requests.length), 2, 'at most two pending Google calls');
  // An earlier prefix is still visible in the current utterance: keep its draft.
  await page.evaluate(() => reply(0, '我們產生了'));
  await page.waitForFunction(() => document.querySelector('.ot-target-line').textContent === '我們產生了');
  assert.equal(await page.locator('.ot-origin-line').textContent(), 'We generated the next step. Astra simply');
  await page.waitForFunction(() => requests.some(r => r.message.action === 'TRANSLATE_TEXTS' && r.message.texts[0].endsWith('simply')));
  const newest = await page.evaluate(() => requests.findIndex(r => r.message.action === 'TRANSLATE_TEXTS' && r.message.texts[0].endsWith('simply')));
  await page.evaluate(index => reply(index, '我們產生了下一步。Astra 只是'), newest);
  await page.waitForFunction(() => document.querySelector('.ot-target-line').textContent === '我們產生了下一步。Astra 只是');
  // Older Google and OpenRouter responses cannot regress the translated prefix.
  await page.evaluate(() => reply(1, '不應蓋回的較短譯文'));
  const earlierRefinement = await page.evaluate(() => requests.findIndex(r => r.message.action === 'REFINE_TEXTS' && r.message.texts[0] === 'We generated'));
  await page.evaluate(index => reply(index, '不應蓋回的舊補譯', false), earlierRefinement);
  assert.equal(await page.locator('.ot-target-line').textContent(), '我們產生了下一步。Astra 只是');
  // Growing the same utterance preserves the displayed draft; a different one clears it.
  await page.evaluate(() => caption('We generated the next step. Astra simply continues.'));
  assert.equal(await page.locator('.ot-target-line').textContent(), '我們產生了下一步。Astra 只是');
  await page.evaluate(() => caption('An entirely different sentence.'));
  await page.waitForFunction(() => document.querySelector('.ot-target-line').textContent === '');
  assert.match(await page.locator('.ot-sub-stage').textContent(), /正在翻譯/);
  await page.waitForFunction(() => requests.some(r => r.message.action === 'TRANSLATE_TEXTS' && r.message.texts[0] === 'An entirely different sentence.'));
  const fresh = await page.evaluate(() => requests.findIndex(r => r.message.action === 'TRANSLATE_TEXTS' && r.message.texts[0] === 'An entirely different sentence.'));
  await page.evaluate(() => { media.paused = true; video.dispatchEvent(new Event('pause')); });
  await page.evaluate(index => reply(index, '另一句話', false), fresh);
  assert.equal(await page.locator('.ot-target-line').textContent(), '另一句話', 'pause preserves the source while its translation completes');
  await page.evaluate(() => { media.paused = false; video.dispatchEvent(new Event('play')); });
  await page.waitForFunction(() => document.querySelector('.ot-target-line').textContent === '另一句話');
  await page.evaluate(() => caption('Please retry this sentence.'));
  await page.waitForFunction(() => requests.some(r => r.message.texts?.[0] === 'Please retry this sentence.'));
  const failed = await page.evaluate(() => requests.findIndex(r => r.message.texts?.[0] === 'Please retry this sentence.'));
  await page.evaluate(index => requests[index].callback({ success: false, error: 'Temporary failure' }), failed);
  await page.waitForFunction(() => requests.filter(r => r.message.texts?.[0] === 'Please retry this sentence.').length === 2);
  const retried = await page.evaluate(() => requests.findLastIndex(r => r.message.texts?.[0] === 'Please retry this sentence.'));
  await page.evaluate(index => reply(index, '重試成功', false), retried);
  await page.waitForFunction(() => document.querySelector('.ot-target-line').textContent === '重試成功');
  assert.deepEqual(errors, []);
  console.log('PASS: growing live captions retain valid prefix translations, coalesce requests, cap Google concurrency, reject older partial replies, preserve pause/resume, and show loading state.');
} finally { await browser.close(); }
