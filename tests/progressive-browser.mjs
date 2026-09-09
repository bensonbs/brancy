import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch();
const errors = [];
const refinement = { targetLang: 'zh-TW', model: 'custom' };
async function fixture(html = '<p>Hello world, this is a translation example.</p>', youtube = false) {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (youtube) {
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://www.youtube.com/watch?v=first');
  } else await page.setContent(html);
  await page.evaluate(() => {
    window.requests = [];
    window.updates = [];
    window.current = true;
    window.handlers = [];
    window.settingListeners = [];
    window.chrome = {
      runtime: { id: 'test', sendMessage(message, callback) { requests.push({ message, callback }); },
        onMessage: { addListener(fn) { handlers.push(fn); } } },
      storage: { local: { get(defaults, callback) { callback(defaults); } },
        onChanged: { addListener(fn) { settingListeners.push(fn); } } }
    };
    window.reply = (index, response) => requests[index].callback(response);
    window.command = () => new Promise(resolve => handlers[0]({ action: 'TOGGLE_PAGE_TRANSLATION' }, {}, resolve));
  });
  await page.addScriptTag({ path: resolve(root, 'content/common/utils.js') });
  return page;
}
async function waitRequests(page, count) { await page.waitForFunction(count => requests.length === count, count); }
async function respond(page, index, data, context = undefined) {
  await page.evaluate(({ index, data, context }) => reply(index, { success: true, data, refinement: context }), { index, data, context });
}
async function start(page, message) {
  await page.evaluate(message => {
    window.firstPassDone = false;
    window.firstPass = BrancyUtils.translateProgressively(message, { onUpdate: result => updates.push(result), isCurrent: () => current }).then(() => { firstPassDone = true; });
  }, message);
}
try {
  const echoed = await fixture();
  const source = '間のゆとりが穏やかな時間を創り出す';
  await start(echoed, { action: 'TRANSLATE_TEXTS', texts: [source] });
  await waitRequests(echoed, 1);
  await respond(echoed, 0, [source], refinement);
  await waitRequests(echoed, 2);
  assert.equal(await echoed.evaluate(() => updates[0].data[0]), '正在翻譯…');
  await echoed.evaluate(() => reply(1, { success: false, error: 'HTTP 503' }));
  await echoed.waitForFunction(() => updates.at(-1).stages[0] === 'untranslated');
  assert.equal(await echoed.evaluate(() => updates.at(-1).data[0]), '未產生譯文，請重試');
  assert.match(await echoed.evaluate(() => updates.at(-1).statuses[0]), /503/);
  await echoed.close();
  // No key: one Google call. Configured key: immediate drafts, bounded automatic refinements.
  const page = await fixture();
  await start(page, { action: 'TRANSLATE_TEXTS', texts: ['Hello'] });
  await respond(page, 0, ['你好']);
  await page.evaluate(() => firstPass);
  assert.equal(await page.evaluate(() => requests.length), 1);
  assert.deepEqual(await page.evaluate(() => updates[0].stages), ['google-only']);
  assert.equal(await page.evaluate(() => BrancyUtils.translationStageLabel(updates[0].stages[0])), '');
  const streaming = await fixture();
  await start(streaming, {action:'TRANSLATE_TEXTS',texts:['first','second']});
  await respond(streaming,0,['暫一','暫二'],refinement);
  await waitRequests(streaming,2);
  await streaming.evaluate(()=>handlers.forEach(fn=>fn({action:'REFINEMENT_PROGRESS',requestId:requests[1].message.requestId,data:['第一句']},{})));
  assert.deepEqual(await streaming.evaluate(()=>updates.at(-1).data),['第一句','暫二']);
  assert.deepEqual(await streaming.evaluate(()=>updates.at(-1).stages),['refining','pending']);
  await streaming.evaluate(()=>reply(1,{success:false,error:'stream interrupted'}));
  await streaming.waitForFunction(()=>updates.at(-1).stages.every(stage=>stage==='google'));
  assert.deepEqual(await streaming.evaluate(()=>updates.at(-1).data),['暫一','暫二']);
  await streaming.evaluate(()=>handlers.forEach(fn=>fn({action:'REFINEMENT_PROGRESS',requestId:'unrelated',data:['錯誤']},{})));
  assert.deepEqual(await streaming.evaluate(()=>updates.at(-1).data),['暫一','暫二']);
  await streaming.close();
  const texts = Array.from({ length: 19 }, (_, i) => `Source ${i}`);
  await start(page, { action: 'TRANSLATE_TEXTS', texts });
  await respond(page, 1, texts.map((_, i) => `暫譯 ${i}`), refinement);
  await waitRequests(page, 4);
  assert.equal(await page.evaluate(() => firstPassDone), true);
  assert.deepEqual(await page.evaluate(() => requests.slice(2).map(r => r.message.texts.length)), [8, 8]);
  assert.deepEqual(await page.evaluate(() => updates.at(-1).stages), Array(19).fill('pending'));
  await respond(page, 3, Array.from({ length: 8 }, (_, i) => `補譯 ${i + 8}`));
  await waitRequests(page, 5);
  assert.equal(await page.evaluate(() => requests[4].message.texts.length), 3);
  await page.evaluate(() => reply(2, { success: false, error: 'OpenRouter 連線逾時' }));
  assert.equal(await page.evaluate(() => updates.at(-1).data[0]), '暫譯 0');
  assert.match(await page.evaluate(() => updates.at(-1).statuses[0]), /逾時/);
  assert.equal(await page.evaluate(() => updates.at(-1).data[8]), '補譯 8');
  // A settings edit cancels pending state and rejects old late replies.
  await page.evaluate(() => settingListeners.forEach(fn => fn({ targetLang: { newValue: 'ja' } }, 'local')));
  assert.equal(await page.evaluate(() => updates.at(-1).stages.includes('pending')), false);
  const updatesBefore = await page.evaluate(() => updates.length);
  await respond(page, 4, ['old', 'old', 'old']);
  assert.equal(await page.evaluate(() => updates.length), updatesBefore);
  await page.close();

  // Subtitle timecodes and dictionary metadata survive the second pass.
  const shapes = await fixture();
  const cues = [{ text: 'Hello', start: 1.25, end: 2.5, duration: 1.25 }];
  await start(shapes, { action: 'TRANSLATE_SUBTITLES', cues, videoId: 'video' });
  await respond(shapes, 0, [{ ...cues[0], translation: '你好' }], refinement);
  await waitRequests(shapes, 2);
  await respond(shapes, 1, ['您好']);
  assert.deepEqual(await shapes.evaluate(() => updates.at(-1).data), [{ ...cues[0], translation: '您好' }]);
  const word = { word: 'hello', translation: '你好', phonetic: '/həˈləʊ/', meanings: [{ definition: 'a greeting' }] };
  await start(shapes, { action: 'LOOKUP_WORD', word: 'hello' });
  await respond(shapes, 2, word, refinement);
  await waitRequests(shapes, 4);
  await respond(shapes, 3, ['您好']);
  assert.deepEqual(await shapes.evaluate(() => updates.at(-1).data), { ...word, translation: '您好' });
  // A malformed/unchanged second pass must never erase a translated draft.
  await start(shapes, { action: 'TRANSLATE_TEXTS', texts: ['Hello'] });
  await respond(shapes, 4, ['你好'], refinement);
  await waitRequests(shapes, 6);
  await respond(shapes, 5, ['Hello']);
  assert.equal(await shapes.evaluate(() => updates.at(-1).data[0]), '你好');
  assert.equal(await shapes.evaluate(() => updates.at(-1).stages[0]), 'google');
  await shapes.close();

  // Real webpage rendering: show provisional status immediately, replace it automatically,
  // and never resurrect restored DOM when a second pass arrives late.
  const web = await fixture();
  await web.addStyleTag({ path: resolve(root, 'content/webpage/webpage.css') });
  await web.addScriptTag({ path: resolve(root, 'content/webpage/webpage.js') });
  await web.evaluate(() => { window.run = command(); });
  await waitRequests(web, 1);
  await respond(web, 0, ['這是 Google 暫譯。'], refinement);
  await web.evaluate(() => run);
  assert.match(await web.locator('.brancy-web-trans').textContent(), /Google 暫譯 · OpenRouter 補譯中/);
  await waitRequests(web, 2);
  await respond(web, 1, ['這是補譯後的內容。']);
  assert.equal(await web.locator('.brancy-translation-status').textContent(), 'OpenRouter');
  assert.match(await web.locator('.brancy-web-trans').textContent(), /補譯後/);
  await web.evaluate(() => command());
  await web.evaluate(() => { window.run = command(); });
  await waitRequests(web, 3);
  await respond(web, 2, ['暫譯'], refinement);
  await waitRequests(web, 4);
  await web.evaluate(() => command());
  await respond(web, 3, ['不應重新出現的補譯']);
  assert.equal(await web.locator('.brancy-web-trans').count(), 0);
  await web.close();

  // Real selection popup: Google is visible before the automatic second pass;
  // closing the popup invalidates the outstanding request.
  const selection = await fixture('<p id="word">Hello</p>');
  await selection.addScriptTag({ path: resolve(root, 'content/webpage/selection.js') });
  await selection.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#word'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.querySelector('#word').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  });
  await waitRequests(selection, 1);
  await respond(selection, 0, word, refinement);
  await waitRequests(selection, 2);
  assert.equal(await selection.locator('.ot-popup-trans').textContent(), '你好');
  assert.match(await selection.locator('.brancy-translation-status').textContent(), /補譯中/);
  await selection.keyboard.press('Escape');
  await respond(selection, 1, ['不應顯示']);
  assert.equal(await selection.locator('.ot-popup-trans').textContent(), '你好');
  assert.equal(await selection.locator('#brancy-selection-popup').evaluate(el => el.classList.contains('hidden')), true);
  await selection.close();
  // Real live-caption renderer: second-pass replies do not move frozen captions.
  const youtube = await fixture(`<div id="movie_player"><video class="html5-main-video"></video>
    <span class="ytp-caption-segment"></span><div class="ytp-right-controls"></div></div>`, true);
  await youtube.evaluate(() => {
    window.BrancyCaptions = { fetchCaptionsForCurrentVideo() {} };
    window.media = { currentTime: 0, paused: false, seeking: false };
    window.video = document.querySelector('video');
    for (const property of Object.keys(media)) Object.defineProperty(video, property, {
      configurable: true, get: () => media[property], set: value => { media[property] = value; }
    });
  });
  await youtube.addScriptTag({ path: resolve(root, 'content/youtube/youtube.js') });
  await youtube.evaluate(() => { document.querySelector('.ytp-caption-segment').textContent = 'First caption'; });
  await waitRequests(youtube, 1);
  await respond(youtube, 0, ['Google 字幕'], refinement);
  await waitRequests(youtube, 2);
  assert.match(await youtube.locator('.ot-sub-stage').textContent(), /Google 暫譯/);
  await youtube.evaluate(() => { media.paused = true; video.dispatchEvent(new Event('pause')); });
  await respond(youtube, 1, ['OpenRouter 字幕']);
  assert.equal(await youtube.locator('.ot-target-line').textContent(), 'OpenRouter 字幕');
  await youtube.evaluate(() => { media.paused = false; video.dispatchEvent(new Event('play')); });
  assert.equal(await youtube.locator('.ot-target-line').textContent(), 'OpenRouter 字幕');
  assert.equal(await youtube.locator('.ot-sub-stage').textContent(), 'OpenRouter');
  await youtube.close();
  assert.deepEqual(errors, []);
  console.log('PASS: Google-first rendering, automatic OpenRouter second pass, no-key single pass, concurrency/batching, timeout fallback, settings cancellation, preserved timecodes/dictionary, webpage status/restore, and selection dismissal.');
} finally { await browser.close(); }
