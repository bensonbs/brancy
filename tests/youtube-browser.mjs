import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch();
const errors = [];
async function fixture() {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
    <video id="unrelated-video"></video>
    <div id="movie_player"><video class="html5-main-video"></video>
    <div class="ytp-caption-window-bottom"><span class="ytp-caption-segment"></span></div>
    <div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="true"></button></div></div>` }));
  await page.goto('https://www.youtube.com/watch?v=first');
  await page.evaluate(() => {
    window.requests = [];
    window.settings = { youtubeSubtitleEnabled: true, shortcutsEnabled: true };
    window.BrancyUtils = {
      async getSettings() { return settings; },
      debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; },
      sendMessageToBackground(message) { return new Promise(resolve => requests.push({ message, resolve })); }
    };
    window.chrome = { storage: { onChanged: { addListener() {} } } };
    window.BrancyCaptions = { fetchCaptionsForCurrentVideo() {} };
    window.media = { currentTime: 0, paused: false, seeking: false };
    window.video = document.querySelector('#movie_player video');
    for (const property of ['currentTime', 'paused', 'seeking']) {
      Object.defineProperty(video, property, { configurable: true, get: () => media[property], set: value => { media[property] = value; } });
    }
    window.caption = text => { document.querySelector('.ytp-caption-segment').textContent = text; };
    window.reply = (text, translation) => {
      requests.find(request => request.message.texts?.[0] === text).resolve({ success: true, data: [translation] });
    };
    window.emitCues = (cues, videoId = 'first') => window.dispatchEvent(new CustomEvent('brancy:cues-ready', { detail: { cues, videoId } }));
  });
  return page;
}
async function expectLines(page, original, translation = '') {
  await page.waitForFunction(({ original, translation }) =>
    document.querySelector('.ot-origin-line')?.textContent === original &&
    document.querySelector('.ot-target-line')?.textContent === translation, { original, translation });
}
async function requestCaption(page, text) {
  await page.evaluate(text => caption(text), text);
  await page.waitForFunction(text => requests.some(request => request.message.texts?.[0] === text), text);
}
try {
  const page = await fixture();
  await page.addScriptTag({ path: resolve(root, 'content/youtube/youtube.js') });
  await requestCaption(page, 'First sentence');
  await expectLines(page, 'First sentence');
  await requestCaption(page, 'Second sentence');
  await page.evaluate(() => reply('Second sentence', '第二句'));
  await expectLines(page, 'Second sentence', '第二句');
  await page.evaluate(() => reply('First sentence', '第一句'));
  await expectLines(page, 'Second sentence', '第二句');

  await requestCaption(page, 'Paused sentence');
  await page.evaluate(() => {
    media.paused = true;
    video.dispatchEvent(new Event('pause'));
    caption('Unrelated DOM change while paused');
    reply('Paused sentence', '暫停後才完成的翻譯');
  });
  await expectLines(page, 'Paused sentence');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => requests.length), 3);
  await expectLines(page, 'Paused sentence');
  await page.evaluate(() => { media.paused = false; video.dispatchEvent(new Event('play')); });
  await page.waitForFunction(() => requests.length === 4);
  await page.evaluate(() => reply('Unrelated DOM change while paused', '恢復播放'));
  await expectLines(page, 'Unrelated DOM change while paused', '恢復播放');

  await requestCaption(page, 'Expired sentence');
  await page.evaluate(() => caption(''));
  await expectLines(page, '');
  await page.evaluate(() => reply('Expired sentence', '過期句子'));
  await expectLines(page, '');

  await requestCaption(page, 'Before seeking');
  await page.evaluate(() => {
    media.paused = true;
    media.seeking = true;
    video.dispatchEvent(new Event('seeking'));
    media.currentTime = 20;
    caption('After seeking');
    media.seeking = false;
    video.dispatchEvent(new Event('seeked'));
    reply('Before seeking', '拖曳前的舊句');
  });
  await expectLines(page, 'After seeking');
  await page.waitForFunction(() => requests.some(request => request.message.texts?.[0] === 'After seeking'));
  await page.evaluate(() => reply('After seeking', '拖曳後的新句'));
  await expectLines(page, 'After seeking');
  await page.evaluate(() => { media.paused = false; video.dispatchEvent(new Event('play')); });
  await expectLines(page, 'After seeking', '拖曳後的新句');

  // Preloaded cues take over immediately at the actual video clock, not at cue zero.
  await page.evaluate(() => {
    media.currentTime = 4;
    media.paused = true;
    emitCues([
      { start: 0, end: 3, text: 'At zero', translation: '零秒' },
      { start: 3, end: 5, text: 'At three', translation: '三秒' },
      { start: 5, end: 8, text: 'At five', translation: '五秒' }
    ]);
  });
  await expectLines(page, 'At three', '三秒');
  await page.evaluate(() => { caption('Native text must not override timed cues'); video.dispatchEvent(new Event('pause')); });
  await expectLines(page, 'At three', '三秒');
  await page.evaluate(() => { media.currentTime = 5; video.dispatchEvent(new Event('seeking')); });
  await expectLines(page, 'At five', '五秒');
  await page.evaluate(() => { media.currentTime = 8; video.dispatchEvent(new Event('timeupdate')); });
  await expectLines(page, '');
  await page.evaluate(() => {
    media.currentTime = 4;
    emitCues([{ start: 0, end: 10, text: 'Old rolling cue' }, { start: 3, end: 6, text: 'Newest rolling cue' }]);
  });
  await expectLines(page, 'Newest rolling cue');

  // Same-length late data from another video must never win.
  await page.evaluate(() => {
    history.pushState({}, '', '/watch?v=second');
    window.dispatchEvent(new Event('yt-navigate-start'));
    window.dispatchEvent(new Event('yt-navigate-finish'));
    emitCues([{ start: 0, end: 100, text: 'Old video' }], 'first');
  });
  await expectLines(page, '');
  await page.evaluate(() => emitCues([{ start: 0, end: 100, text: 'New video' }], 'second'));
  await expectLines(page, 'New video');
  await page.evaluate(() => {
    window.detachedVideo = video;
    const replacement = document.createElement('video');
    replacement.className = 'html5-main-video';
    for (const key of ['currentTime', 'paused', 'seeking']) {
      Object.defineProperty(replacement, key, { get: () => media[key] });
    }
    video.replaceWith(replacement);
    window.video = replacement;
  });
  await page.waitForTimeout(180);
  await expectLines(page, 'New video');
  await page.evaluate(() => detachedVideo.dispatchEvent(new Event('emptied')));
  await expectLines(page, 'New video');
  console.log('PASS: out-of-order replies, paused DOM/replies, resume, expired captions, paused seeking, cue boundaries/overlaps, preloaded-cue takeover, and navigation.');
  await page.close();

  const managerPage = await fixture();
  await managerPage.addScriptTag({ path: resolve(root, 'content/youtube/youtube-captions.js') });
  const original = [{ tStartMs: 1000, dDurationMs: 100, segs: [{ utf8: 'A short fragment' }] },
    { tStartMs: 1100, dDurationMs: 1900, segs: [{ utf8: 'the next fragment' }] }];
  await managerPage.evaluate(events => {
    window.published = [];
    window.addEventListener('brancy:cues-ready', event => published.push(event.detail));
    BrancyCaptions.handleNativeTimedText(JSON.stringify({ events }), 'first');
  }, original);
  assert.deepEqual(await managerPage.evaluate(() => BrancyCaptions.cues.map(cue => [cue.start, cue.end, cue.text])),
    [[1, 1.1, 'A short fragment'], [1.1, 3, 'the next fragment']]);
  assert.equal(await managerPage.evaluate(() => published.length), 1);
  await managerPage.evaluate(events => BrancyCaptions.handleNativeTimedText(JSON.stringify({ events }), 'first'), original);
  assert.equal(await managerPage.evaluate(() => requests.length), 1);
  await managerPage.evaluate(() => {
    requests[0].resolve({ success: true, data: [{ start: 900, end: 901, text: 'Wrong clock', translation: '短句' }, { translation: '下一句' }] });
  });
  await managerPage.waitForFunction(() => published.length === 2);
  assert.equal(await managerPage.evaluate(() => BrancyCaptions.cues[0].start), 1);
  assert.equal(await managerPage.evaluate(() => BrancyCaptions.cues[0].text), 'A short fragment');
  assert.equal(await managerPage.evaluate(() => BrancyCaptions.cues[0].translation), '短句');
  await managerPage.evaluate(() => {
    history.pushState({}, '', '/watch?v=second');
    BrancyCaptions.handleNativeTimedText(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Second video' }] }] }), 'second');
    history.pushState({}, '', '/watch?v=third');
    BrancyCaptions.handleNativeTimedText(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Third video' }] }] }), 'third');
    BrancyCaptions.handleTracksFound([{ baseUrl: 'old-track' }], 'second');
    BrancyCaptions.handleNativeTimedText('{"events":[]}', 'second');
    requests[1].resolve({ success: true, data: [{ translation: '遲到的第二支影片' }] });
    requests[2].resolve({ success: true, data: [{ translation: '第三支影片' }] });
  });
  await managerPage.waitForFunction(() => BrancyCaptions.cues[0].translation === '第三支影片');
  assert.equal(await managerPage.evaluate(() => BrancyCaptions.currentTracks), null);
  assert.equal(await managerPage.evaluate(() => published.filter(event => event.videoId === 'second').length), 1);
  console.log('PASS: original timestamps, immediate source cues, duplicate native captures, translation clock isolation, old video/track rejection.');
  await managerPage.close();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
