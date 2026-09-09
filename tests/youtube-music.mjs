import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch();
const errors = [];
async function fixture() {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="movie_player"><video class="html5-main-video"></video><span class="ytp-caption-segment"></span><div class="ytp-right-controls"></div></div>' }));
  await page.goto('https://www.youtube.com/watch?v=music');
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
  });
  await page.addScriptTag({ path: resolve(root, 'content/common/utils.js') });
  return page;
}
try {
  const live = await fixture();
  const cleaned = await live.evaluate(() => ['[音樂]', '[Music]', '[ music ]', '【音乐】', '［Music］', '（音樂）', '(Music)', '[音楽]', 'Hello [Music] world', 'I study music.', '[Applause]', '[music theory]'].map(BrancyUtils.stripMusicLabels));
  assert.deepEqual(cleaned, ['', '', '', '', '', '', '', '', 'Hello world', 'I study music.', '[Applause]', '[music theory]']);
  await live.addScriptTag({ path: resolve(root, 'content/youtube/youtube.js') });
  await live.evaluate(() => caption('[Music]'));
  await live.waitForTimeout(160);
  assert.equal(await live.evaluate(() => requests.length), 0, 'music-only live cues never reach Google/OpenRouter');
  assert.equal(await live.locator('.ot-origin-line').textContent(), '');
  await live.evaluate(() => caption('[Music] Hello there'));
  await live.waitForFunction(() => requests.length === 1);
  assert.deepEqual(await live.evaluate(() => requests[0].message.texts), ['Hello there']);
  await live.evaluate(() => requests[0].callback({ success: true, data: ['[音樂] 你好'], refinement: { targetLang: 'zh-TW', model: 'custom' } }));
  await live.waitForFunction(() => document.querySelector('.ot-target-line').textContent === '你好');
  await live.waitForFunction(() => requests.length === 2);
  await live.evaluate(() => requests[1].callback({ success: true, data: ['您好 【音樂】'] }));
  await live.waitForFunction(() => document.querySelector('.ot-target-line').textContent === '您好');
  await live.evaluate(() => caption('[音樂]'));
  await live.waitForFunction(() => document.querySelector('.ot-origin-line').textContent === '');
  assert.equal(await live.locator('.ot-target-line').textContent(), '');
  assert.equal(await live.evaluate(() => requests.length), 2);
  await live.close();

  const timed = await fixture();
  await timed.addScriptTag({ path: resolve(root, 'content/youtube/youtube-captions.js') });
  await timed.evaluate(() => { BrancyCaptions.handleNativeTimedText(JSON.stringify({ events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '[Music]' }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: '[音樂] Hello there' }] },
    { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: '【音乐】' }] },
    { tStartMs: 6000, dDurationMs: 2000, segs: [{ utf8: 'I love music.' }] }
  ] }), 'music'); });
  assert.deepEqual(await timed.evaluate(() => requests[0].message.cues.map(cue => [cue.text, cue.start, cue.end])), [['Hello there', 2, 4], ['I love music.', 6, 8]]);
  await timed.addScriptTag({ path: resolve(root, 'content/youtube/youtube.js') });
  await timed.evaluate(() => requests[0].callback({ success: true, data: requests[0].message.cues.map(cue => ({ ...cue, translation: '[音樂] 你好' })) }));
  await timed.waitForFunction(() => BrancyCaptions.cues[0].translation === '你好');
  await timed.evaluate(() => { media.currentTime = 2.5; video.dispatchEvent(new Event('timeupdate')); });
  await timed.waitForFunction(() => document.querySelector('.ot-target-line').textContent === '你好');
  await timed.evaluate(() => { media.currentTime = 4.5; video.dispatchEvent(new Event('timeupdate')); });
  assert.equal(await timed.locator('.ot-origin-line').textContent(), '', 'filtered music interval remains an empty gap, not an extended dialogue');
  assert.equal(await timed.locator('.ot-target-line').textContent(), '');
  assert.deepEqual(errors, []);
  console.log('PASS: music labels filtered before requests and after both translations; mixed dialogue and music-related speech retained; original cue timing and empty gaps preserved.');
} finally { await browser.close(); }
