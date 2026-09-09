import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="movie_player"><video class="html5-main-video"></video><div class="ytp-right-controls"></div></div>' }));
  await page.goto('https://www.youtube.com/watch?v=window');
  await page.evaluate(() => {
    window.requests = [];
    window.published = [];
    window.settingListeners = [];
    window.media = { currentTime: 300, paused: false, seeking: false };
    window.video = document.querySelector('video');
    for (const key of Object.keys(media)) Object.defineProperty(video, key, { configurable: true, get: () => media[key] });
    window.chrome = {
      runtime: { id: 'test', sendMessage(message, callback) { requests.push({ message, callback }); } },
      storage: { local: { get(defaults, callback) { callback(defaults); } }, onChanged: { addListener(fn) { settingListeners.push(fn); } } }
    };
    window.addEventListener('brancy:cues-ready', event => published.push(event.detail));
    window.replyGoogle = index => {
      const { message, callback } = requests[index];
      callback({ success: true, refinement: { targetLang: 'zh-TW', model: 'custom' },
        data: message.cues.map(cue => ({ ...cue, translation: `Google ${cue.id}` })) });
    };
    window.replyRefinement = index => requests[index].callback({ success: true,
      data: requests[index].message.texts.map(text => `OpenRouter ${text}`) });
  });
  await page.addScriptTag({ path: resolve(root, 'content/common/utils.js') });
  await page.addScriptTag({ path: resolve(root, 'content/youtube/youtube-captions.js') });
  await page.evaluate(() => {
    const events = Array.from({ length: 600 }, (_, i) => ({ tStartMs: i * 3000, dDurationMs: 3000, segs: [{ utf8: `Cue ${i}` }] }));
    BrancyCaptions.handleNativeTimedText(JSON.stringify({ events }), 'window');
  });
  await page.addScriptTag({ path: resolve(root, 'content/youtube/youtube.js') });
  await page.waitForFunction(() => requests.length === 2);
  assert.deepEqual(await page.evaluate(() => requests.map(request => request.message.cues.length)), [1, 8]);
  assert.equal(await page.evaluate(() => requests[0].message.cues[0].id), 100, 'start at the playhead, not at the start of the video');
  assert.equal(await page.evaluate(() => BrancyCaptions.cues.length), 600);
  assert.equal(await page.locator('.ot-origin-line').textContent(), 'Cue 100');
  assert.equal(await page.locator('.ot-target-line').textContent(), '');
  await page.evaluate(() => replyGoogle(0));
  await page.waitForFunction(() => document.querySelector('.ot-target-line').textContent === 'Google 100');
  assert.match(await page.locator('.ot-sub-stage').textContent(), /Google 暫譯/);
  assert.equal(await page.evaluate(() => BrancyCaptions.cues[101].translation), '', 'first small batch displays before the second Google response');
  assert.ok(await page.evaluate(() => requests.filter(request => request.message.action === 'TRANSLATE_SUBTITLES').every(request => request.message.cues.length <= 8 && request.message.cues.every(cue => cue.start <= 345))));

  // Seek while two old Google requests and one OpenRouter request are in flight.
  await page.evaluate(() => {
    media.currentTime = 600; media.seeking = true; video.dispatchEvent(new Event('seeking'));
    media.seeking = false; video.dispatchEvent(new Event('seeked'));
    replyGoogle(1);
  });
  await page.waitForFunction(() => requests.some(request => request.message.cues?.[0].id === 200));
  const newGoogle = await page.evaluate(() => requests.findIndex(request => request.message.cues?.[0].id === 200));
  assert.equal(await page.locator('.ot-origin-line').textContent(), 'Cue 200');
  await page.evaluate(index => replyGoogle(index), newGoogle);
  await page.waitForFunction(() => document.querySelector('.ot-target-line').textContent === 'Google 200');
  const oldRefinement = await page.evaluate(() => requests.findIndex(request => request.message.action === 'REFINE_TEXTS' && request.message.texts[0] === 'Cue 100'));
  await page.evaluate(index => replyRefinement(index), oldRefinement);
  await page.waitForFunction(() => BrancyCaptions.cues[100].translation === 'OpenRouter Cue 100');
  assert.equal(await page.locator('.ot-target-line').textContent(), 'Google 200', 'late old-position refinement cannot move the displayed subtitle');
  await page.waitForFunction(() => requests.some(request => request.message.action === 'REFINE_TEXTS' && request.message.texts[0] === 'Cue 200'));
  const newRefinement = await page.evaluate(() => requests.findIndex(request => request.message.action === 'REFINE_TEXTS' && request.message.texts[0] === 'Cue 200'));
  await page.evaluate(index => replyRefinement(index), newRefinement);
  await page.waitForFunction(() => document.querySelector('.ot-target-line').textContent === 'OpenRouter Cue 200');
  assert.equal(await page.evaluate(() => BrancyCaptions.cues[100].translation), 'OpenRouter Cue 100', 'merging one batch keeps earlier batches');
  assert.deepEqual(await page.evaluate(() => [BrancyCaptions.cues[200].start, BrancyCaptions.cues[200].end]), [600, 603]);

  // Fill the bounded window while paused; it must eventually stop requesting,
  // instead of running through all 600 cues in the background.
  await page.evaluate(async () => {
    media.paused = true; video.dispatchEvent(new Event('pause'));
    window.answered = new Set([0, 1]);
    for (let round = 0; round < 20; round++) {
      for (const [index, request] of requests.entries()) {
        if (request.message.action === 'TRANSLATE_SUBTITLES' && !answered.has(index)) {
          answered.add(index); replyGoogle(index);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  });
  const googleCount = await page.evaluate(() => requests.filter(request => request.message.action === 'TRANSLATE_SUBTITLES').length);
  await page.evaluate(() => video.dispatchEvent(new Event('timeupdate')));
  assert.equal(await page.evaluate(() => requests.filter(request => request.message.action === 'TRANSLATE_SUBTITLES').length), googleCount);
  assert.ok(googleCount < 12, 'only old and new playback windows were translated');
  assert.equal(await page.evaluate(() => requests.filter(request => request.message.cues).some(request => request.message.cues.some(cue => cue.start > 645))), false);

  // Changing translation settings restarts only the current window and clears
  // old-language completion markers. Old second-pass replies remain invalid.
  const requestsBeforeChange = await page.evaluate(() => requests.length);
  await page.evaluate(() => settingListeners.forEach(fn => fn({ targetLang: { newValue: 'ja' } }, 'local')));
  const restarted = await page.evaluate(start => requests.slice(start).filter(request => request.message.cues).map(request => request.message.cues.map(cue => cue.id)), requestsBeforeChange);
  assert.equal(restarted[0][0], 200);
  assert.deepEqual(restarted.map(batch => batch.length), [1, 8]);
  assert.equal(await page.evaluate(() => BrancyCaptions.cues[100].translation), '');
  await page.evaluate(index => replyRefinement(index), oldRefinement);
  assert.equal(await page.evaluate(() => BrancyCaptions.cues[100].translation), '');

  // A transient failed Google batch is retried once, even while paused.
  const failedGoogle = await page.evaluate(start => requests.findIndex((r, index) => index >= start && r.message.cues?.[0].id === 200), requestsBeforeChange);
  const beforeRetry = await page.evaluate(() => requests.length);
  await page.evaluate(index => requests[index].callback({ success: false, error: 'Temporary failure' }), failedGoogle);
  await page.waitForFunction(start => requests.slice(start).some(r => r.message.cues?.[0].id === 200), beforeRetry);
  const retryGoogle = await page.evaluate(start => requests.findIndex((r, index) => index >= start && r.message.cues?.[0].id === 200), beforeRetry);
  await page.evaluate(index => replyGoogle(index), retryGoogle);
  await page.waitForFunction(() => BrancyCaptions.cues[200].translation === 'Google 200');

  // Navigation invalidates queued work and late responses for the old track.
  await page.evaluate(() => { window.dispatchEvent(new Event('yt-navigate-start')); });
  const publishCount = await page.evaluate(() => published.length);
  await page.evaluate(() => {
    requests.forEach((request, index) => {
      if (request.message.action === 'REFINE_TEXTS') replyRefinement(index);
    });
  });
  assert.equal(await page.evaluate(() => published.length), publishCount);
  assert.equal(await page.locator('.ot-origin-line').textContent(), '');
  assert.deepEqual(errors, []);
  console.log('PASS: 600-cue track starts at playhead; current cue displays independently; bounded lookahead; seeking reprioritizes Google/OpenRouter; late replies preserve current time and other batches; settings restart the current window; navigation cancels.');
} finally { await browser.close(); }
