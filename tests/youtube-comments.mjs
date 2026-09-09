import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
    <style>body{margin:40px;font:14px/1.6 sans-serif;color:#222}main{width:600px}aside{position:absolute;left:700px;top:40px;width:200px}ytd-comment-view-model{display:block;margin:24px 0}ytd-expander{display:block;max-height:45px;overflow:hidden}.author{color:#666}yt-attributed-string{display:inline}button{margin-top:10px}</style>
    <main><div id="above-the-fold"><div id="title"><h1>What does understanding mean?</h1></div></div>
    <div id="comments"><ytd-comment-view-model><div id="main"><h3 class="author">@viewer-name</h3><ytd-expander><div id="content"><yt-attributed-string id="content-text">Such a clear and well-structured explanation. Keep up the great work!</yt-attributed-string></div></ytd-expander><button>Reply</button></div></ytd-comment-view-model>
    <ytd-comment-view-model><div id="main"><h3 class="author">@another-viewer</h3><ytd-expander><div id="content"><yt-attributed-string id="content-text">The future is easier to understand when we ask better questions.</yt-attributed-string></div></ytd-expander><button>Reply</button></div></ytd-comment-view-model></div>
    <div contenteditable="true">My unfinished comment must stay private.</div></main>
    <aside><h3>Recommended video should remain untouched</h3></aside><div id="movie_player"><span class="ytp-caption-segment">Playing caption must remain untouched</span></div>` }));
  await page.goto('https://www.youtube.com/watch?v=comments');
  await page.addStyleTag({ path: resolve(root, 'content/webpage/webpage.css') });
  await page.evaluate(() => {
    window.handlers = [];
    window.requests = [];
    window.chrome = { runtime: { onMessage: { addListener(fn) { handlers.push(fn); } } } };
    window.BrancyUtils = {
      async getSettings() { return { engine: 'google_free' }; },
      sendMessageToBackground(message) { return new Promise(resolve => requests.push({ message, resolve })); },
      escapeHtml(text) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    };
    window.command = () => new Promise(resolve => handlers[0]({ action: 'TOGGLE_PAGE_TRANSLATION' }, {}, resolve));
    window.reply = (index, text = '清楚的解說，讓我們更容易理解。') => requests[index].resolve({ success: true, data: requests[index].message.texts.map(() => text) });
    window.addComment = text => {
      const comment = document.createElement('ytd-comment-view-model');
      comment.innerHTML = '<div id="main"><h3>@new-viewer</h3><ytd-expander><div id="content"><yt-attributed-string id="content-text"></yt-attributed-string></div></ytd-expander><button>Reply</button></div>';
      comment.querySelector('#content-text').textContent = text;
      document.querySelector('#comments').appendChild(comment);
    };
  });
  await page.addScriptTag({ path: resolve(root, 'content/webpage/webpage.js') });
  await page.evaluate(() => { window.firstRun = command(); });
  await page.waitForFunction(() => requests.length === 1);
  const requested = await page.evaluate(() => requests[0].message.texts);
  assert.equal(requested.length, 3);
  assert.ok(requested.some(text => text.startsWith('Such a clear')));
  assert.ok(requested.every(text => !text.includes('Recommended') && !text.includes('@') && !text.includes('unfinished')));
  assert.equal(await page.locator('ytd-expander .brancy-web-trans').count(), 0);
  assert.equal(await page.locator('ytd-expander + .brancy-youtube-trans').count(), 2);
  assert.equal(await page.locator('aside .brancy-web-trans, #movie_player .brancy-web-trans').count(), 0);
  for (const block of await page.locator('ytd-expander + .brancy-youtube-trans').all()) {
    const bounds = await block.evaluate(el => ({ height: el.getBoundingClientRect().height, left: el.getBoundingClientRect().left, sourceLeft: el.previousElementSibling.getBoundingClientRect().left }));
    assert.ok(bounds.height < 30);
    assert.equal(bounds.left, bounds.sourceLeft);
  }
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: resolve(root, 'artifacts/youtube-comments-loading.png'), fullPage: true });
  await page.evaluate(() => reply(0));
  await page.evaluate(() => firstRun);
  assert.equal(await page.locator('.brancy-youtube-trans:not(.ot-shimmer-loading)').count(), 3);
  await page.screenshot({ path: resolve(root, 'artifacts/youtube-comments-translated.png'), fullPage: true });
  // Replies/comments inserted later are translated only once.
  await page.evaluate(() => addComment('A freshly loaded reply.'));
  await page.waitForFunction(() => requests.length === 2);
  assert.deepEqual(await page.evaluate(() => requests[1].message.texts), ['A freshly loaded reply.']);
  await page.evaluate(() => reply(1));
  await page.waitForFunction(() => document.querySelectorAll('.brancy-youtube-trans:not(.ot-shimmer-loading)').length === 4);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => requests.length), 2);
  // YouTube may reuse a comment element while sorting. Discard its old translation.
  await page.evaluate(() => { document.querySelector('#content-text').textContent = 'Changed comment after sorting.'; });
  await page.waitForFunction(() => requests.length === 3);
  assert.deepEqual(await page.evaluate(() => requests[2].message.texts), ['Changed comment after sorting.']);
  await page.evaluate(() => reply(2));
  await page.waitForFunction(() => document.querySelectorAll('.brancy-youtube-trans:not(.ot-shimmer-loading)').length === 4);
  // Restoring during an in-flight request must remove loading UI permanently.
  await page.evaluate(() => addComment('Pending comment before restore.'));
  await page.waitForFunction(() => requests.length === 4);
  await page.evaluate(() => command());
  await page.evaluate(() => reply(3));
  assert.equal(await page.locator('.brancy-web-trans, [data-ot-translated]').count(), 0);
  await page.evaluate(() => addComment('After restoring, do not translate automatically.'));
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => requests.length), 4);
  // Navigating stops translation and prevents old page responses from appearing.
  await page.evaluate(() => { window.nextRun = command(); });
  await page.waitForFunction(() => requests.length === 5);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('yt-navigate-start'));
    reply(4);
  });
  await page.evaluate(() => nextRun);
  assert.equal(await page.locator('.brancy-web-trans, [data-ot-translated]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: YouTube comments/replies, compact loading placement, excluded recommendations/player/editor, lazy comments, reused nodes, restore/cancel, and navigation.');
} finally { await browser.close(); }
