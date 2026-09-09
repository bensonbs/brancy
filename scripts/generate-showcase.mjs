// Render README illustrations from the real extension UI using fictional demo data.
// Run: node scripts/generate-showcase.mjs (requires Playwright Chromium).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'docs/images');
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + '/')) return res.writeHead(403).end();
  try {
    res.setHeader('Content-Type', { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[extname(path)] || 'text/plain');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.addInitScript(() => {
  window.demoSettings = {
    targetLang: 'zh-TW', openRouterKey: '', openRouterModel: 'deepseek/deepseek-v4-flash-0731',
    youtubeSubtitleEnabled: true, webSelectionEnabled: true, shortcutsEnabled: true,
    youtubeSubBg: 'rgba(0, 0, 0, 0.75)', youtubeFontSize: 22, youtubeOriginFontSize: 15
  };
  window.demoHandlers = [];
  window.demoRefinements = [];
  const request = message => {
    if (message.action === 'GET_SETTINGS') return { success: true, settings: demoSettings };
    if (message.action === 'TRANSLATE_TEXTS') return { success: true,
      data: message.texts.map(text => window.demoTranslations[text]?.[0] || text),
      refinement: { targetLang: 'zh-TW', model: 'demo-model' } };
    if (message.action === 'REFINE_TEXTS') return new Promise(resolve => demoRefinements.push(() => resolve({ success: true,
      data: message.texts.map(text => window.demoTranslations[text]?.[1] || text) })));
    return { success: true };
  };
  window.chrome = {
    runtime: { id: 'brancy-showcase', sendMessage(message, callback) {
      const result = Promise.resolve(request(message));
      if (callback) result.then(callback);
      return result;
    }, onMessage: { addListener(fn) { demoHandlers.push(fn); } }, openOptionsPage() {} },
    storage: { local: { get(defaults, callback) { callback({ ...defaults, ...demoSettings }); } }, onChanged: { addListener() {} } }
  };
  window.demoTranslate = () => new Promise(resolve => demoHandlers[0]({ action: 'TOGGLE_PAGE_TRANSLATION' }, {}, resolve));
  window.demoFinish = () => demoRefinements.splice(0).forEach(finish => finish());
});
const font = '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC",sans-serif';
const base = `*{box-sizing:border-box}body{margin:0;background:#f6f6f4;color:#1b1b1b;font-family:${font};-webkit-font-smoothing:antialiased}.brand{display:flex;align-items:center;gap:12px;font-size:27px;font-weight:650;letter-spacing:-1px}.brand img{width:44px;height:44px}.eyebrow{font-size:12px;letter-spacing:2px;color:#737373}.foot{position:absolute;bottom:34px;left:64px;right:64px;display:flex;justify-content:space-between;font-size:12px;color:#777}.chrome{height:44px;background:#fafafa;border-bottom:1px solid #e9e9e9;display:flex;align-items:center;padding:0 18px;gap:6px}.dot{width:7px;height:7px;border-radius:50%;background:#d2d2d2}.chrome span{font-size:11px;color:#777;margin:auto}.window{overflow:hidden;border:1px solid #dededb;border-radius:12px;background:white}iframe{border:0;display:block}.headline{font-size:40px;line-height:1.3;letter-spacing:-1.8px;margin:22px 0 14px}.subtitle{font-size:17px;color:#666;margin:0;line-height:1.8}`;
const logoData = (await readFile(resolve(root, 'icons/icon128.png'))).toString('base64');
const brand = `<div class="brand"><img src="data:image/png;base64,${logoData}" alt="Brancy logo">brancy</div>`;
const chrome = label => `<div class="chrome"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span>${label}</span></div>`;
async function save(page, name) {
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => [...document.images].every(img => img.complete && img.naturalWidth > 0)), true);
  await page.screenshot({ path: resolve(output, name), animations: 'disabled' });
}
async function contentScripts(frame) {
  await frame.addStyleTag({ path: resolve(root, 'content/webpage/webpage.css') });
  await frame.addScriptTag({ path: resolve(root, 'content/common/utils.js') });
  await frame.addScriptTag({ path: resolve(root, 'content/webpage/webpage.js') });
}
try {
  await mkdir(output, { recursive: true });
  const overview = await context.newPage();
  await overview.goto(origin + '/README.md');
  await overview.setContent(`<style>${base}
    .copy{position:absolute;left:96px;top:88px;width:655px}.copy h1{font-size:84px;letter-spacing:-5px;line-height:1.13;margin:68px 0 24px;font-weight:650}.lead{font-size:23px;color:#6a6a6a;line-height:1.7}.features{margin-top:54px;width:525px;border-top:1px solid #dadad7}.row{display:flex;align-items:center;gap:18px;border-bottom:1px solid #dadad7;padding:17px 0;font-size:16px}.num{font-size:11px;color:#888;letter-spacing:1px}.demo{position:absolute;top:100px;right:145px;box-shadow:0 20px 70px #0000000c}.demo iframe{width:344px;height:602px}.caption{position:absolute;right:145px;top:773px;width:344px;text-align:center;font-size:12px;color:#777}
    </style><div class="copy">${brand}<h1>讀懂，更多。</h1><div class="lead">讓語言簡單一點。<br>輕量、安靜的雙語閱讀體驗。</div><div class="features"><div class="row"><span class="num">01</span>Google 免金鑰，開啟就能翻譯</div><div class="row"><span class="num">02</span>設定 OpenRouter，自動再補譯一次</div><div class="row"><span class="num">03</span>網頁、影片字幕、評論，一起讀懂</div></div></div><div class="window demo">${chrome('Brancy · 擴充功能面板')}<iframe src="${origin}/popup/popup.html"></iframe></div><div class="caption">實際操作介面 · 預設使用 Google 翻譯</div><div class="foot"><span>CHROME EXTENSION</span><span>簡單 · 輕量 · 黑白灰</span></div>`);
  const popup = overview.frameLocator('iframe');
  await popup.locator('#ot-current-model').filter({ hasText: 'Google 暫譯' }).waitFor();
  assert.equal(await popup.locator('#ot-sw-yt-subs').isChecked(), true);
  await save(overview, 'overview.png');

  const comparison = await context.newPage();
  await comparison.goto(origin + '/README.md');
  await comparison.setContent(`<style>${base}.header{padding:48px 64px 0}.top{display:flex;align-items:center;justify-content:space-between}.cols{display:flex;gap:28px;margin:36px 64px}.col{flex:1;min-width:0}.state{display:flex;align-items:center;gap:12px;margin-bottom:14px;font-size:18px;font-weight:550}.pill{padding:5px 10px;background:#e9e9e6;border-radius:5px;font-size:11px;letter-spacing:1px}.final .pill{background:#222;color:white}.window iframe{width:100%;height:466px}</style>
    <div class="header"><div class="top">${brand}<span class="eyebrow">BILINGUAL READING</span></div><h1 class="headline">先讀暫譯，再讀懂細節。</h1><p class="subtitle">有設定 OpenRouter，就自動跑第二次。譯文狀態，清楚顯示在原來的位置。</p></div>
    <div class="cols"><div class="col"><div class="state"><span class="pill">01 · GOOGLE</span>先顯示暫譯</div><div class="window">${chrome('示範文章 · 雙語閱讀')}<iframe src="${origin}/README.md" name="draft"></iframe></div></div><div class="col final"><div class="state"><span class="pill">02 · OPENROUTER</span>自動補譯完成</div><div class="window">${chrome('同一段文章 · 更新後')}<iframe src="${origin}/README.md" name="final"></iframe></div></div></div><div class="foot"><span>示範文章與模擬翻譯 · 使用實際翻譯介面渲染</span><span>未設定 OpenRouter 時，僅使用 Google</span></div>`);
  const source = 'A little curiosity can open up a whole new world.';
  for (const name of ['draft', 'final']) {
    const frame = comparison.frame({ name });
    await frame.waitForLoadState();
    await frame.setContent(`<style>body{margin:0;padding:38px 34px;font:19px/1.7 ${font};color:#222}.meta{font-size:10px;letter-spacing:2px;color:#777;margin-bottom:30px}.title{font-size:28px;line-height:1.3;font-weight:550;margin-bottom:28px;letter-spacing:-.7px}.rule{height:1px;background:#eee;margin:26px 0}.end{font-size:12px;color:#888}.brancy-toast{display:none!important}</style><article><div class="meta">READING NOTES / 001</div><div class="title">Stay curious.<br>Read beyond the familiar.</div><p>${source}</p><div class="rule"></div><div class="end">保持好奇，從讀懂一句話開始。</div></article>`);
    await frame.evaluate(source => { window.demoTranslations = { [source]: ['一點好奇心可以打開一個全新的世界。', '一點好奇心，就能為你開啟全新的世界。'] }; }, source);
    await contentScripts(frame);
    await frame.evaluate(() => demoTranslate());
    if (name === 'final') {
      await frame.evaluate(() => demoFinish());
      await frame.locator('.brancy-translation-status').filter({ hasText: /^OpenRouter$/ }).waitFor();
    } else await frame.locator('.brancy-translation-status').filter({ hasText: '補譯中' }).waitFor();
  }
  await save(comparison, 'translation-stages.png');

  const youtube = await context.newPage();
  const videoTitle = 'The small things that help us learn';
  const comments = ['I love how a simple question can change the way we see things.', 'This made me want to slow down and pay more attention.'];
  const html = `<style>${base}
    .header{padding:42px 64px 0}.top{display:flex;justify-content:space-between;align-items:center}.layout{margin:28px 64px;display:grid;grid-template-columns:730px 1fr;gap:38px}#movie_player{position:relative;height:400px;background:#242424;overflow:hidden;border-radius:9px;color:#fff}.video-art{position:absolute;inset:0;padding:48px}.video-kicker{font-size:10px;color:#aaa;letter-spacing:3px}.video-art h2{font-size:58px;line-height:1.05;font-weight:400;letter-spacing:-2px;margin:28px 0}.video-art .line{height:1px;background:#555;width:80px;margin-top:30px}.video-controls{position:absolute;bottom:17px;left:24px;right:24px;font-size:11px;color:#ccc;border-top:2px solid #777;padding-top:12px}video{position:absolute;width:1px;height:1px;opacity:0}.ytp-right-controls{position:absolute;right:18px;bottom:10px}.ytp-caption-segment{display:none}#title h1{font-size:22px;margin:20px 0 2px;font-weight:550}#comments{background:white;border:1px solid #dfdfdc;border-radius:9px;padding:25px 24px}.comment-heading{font-size:13px;color:#777;padding-bottom:20px;border-bottom:1px solid #eee}ytd-comment-view-model{display:block;margin-top:25px;font-size:15px;line-height:1.7}ytd-expander{display:block}.author{font-size:11px;color:#777;margin-bottom:8px}.reply{font-size:11px;color:#888;margin-top:12px}.brancy-toast{display:none!important}.annotation{font-size:13px;color:#777;margin-top:18px;line-height:1.8}</style>
    <div class="header"><div class="top">${brand}<span class="eyebrow">YOUTUBE · SUBTITLES & COMMENTS</span></div><h1 class="headline">影片裡的話，評論裡的想法。</h1><p class="subtitle">字幕依播放時間同步，評論在原文下方翻譯。</p></div><div class="layout"><main><div id="movie_player"><video class="html5-main-video"></video><div class="video-art"><div class="video-kicker">DEMO LESSON / 01</div><h2>Small things.<br>New perspectives.</h2><div class="line"></div></div><span class="ytp-caption-segment"></span><div class="video-controls">Ⅱ &nbsp; 0:24 / 2:30</div><div class="ytp-right-controls"></div></div><div id="above-the-fold"><div id="title"><h1>${videoTitle}</h1></div></div><div class="annotation">暫停、拖曳，字幕跟著影片的時間走。</div></main><div id="comments"><div class="comment-heading">評論 · 原文與翻譯一起閱讀</div>${comments.map((text,i)=>`<ytd-comment-view-model><div class="author">@demo_reader_${i+1} · 示範評論</div><ytd-expander><div id="content-text">${text}</div></ytd-expander><div class="reply">回覆</div></ytd-comment-view-model>`).join('')}</div></div><div class="foot"><span>示範影片、評論及模擬翻譯 · 使用實際字幕與評論介面渲染</span><span>網頁翻譯，從右鍵選單開始</span></div>`;
  await youtube.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8">' + html }));
  await youtube.goto('https://www.youtube.com/watch?v=brancy-demo');
  await youtube.evaluate(({videoTitle,comments}) => {
    window.demoTranslations = {
      [videoTitle]: ['幫助我們學習的小事', '那些幫助我們學習的小事'],
      [comments[0]]: ['我喜歡一個簡單的問題如何改變我們看事情的方式。', '我很喜歡這點：一個簡單的問題，就能改變我們看待事物的方式。'],
      [comments[1]]: ['這讓我想慢下來並更加注意。', '看完之後，我想放慢腳步，更用心留意身邊的事。']
    };
    window.BrancyCaptions = { fetchCaptionsForCurrentVideo() {} };
    const video = document.querySelector('video');
    Object.defineProperty(video,'currentTime',{get:()=>24});
    Object.defineProperty(video,'paused',{get:()=>true});
  }, { videoTitle, comments });
  await contentScripts(youtube);
  await youtube.addStyleTag({ path: resolve(root, 'content/youtube/youtube.css') });
  await youtube.addScriptTag({ path: resolve(root, 'content/youtube/youtube.js') });
  await youtube.evaluate(() => demoTranslate());
  await youtube.evaluate(() => demoFinish());
  await youtube.locator('.brancy-youtube-trans[data-translation-stage="openrouter"]').first().waitFor();
  await youtube.evaluate(() => window.dispatchEvent(new CustomEvent('brancy:cues-ready', { detail: {
    videoId: 'brancy-demo', cues: [{ text: 'Stay curious about the little things.', translation: '對日常的小事，保持好奇。', translationStage: 'openrouter', start: 22, end: 27 }]
  } })));
  await youtube.locator('.ot-target-line').filter({ hasText: '對日常的小事' }).waitFor();
  assert.equal(await youtube.locator('.brancy-youtube-trans').count(), 3);
  await save(youtube, 'youtube-demo.png');
  assert.deepEqual(errors, []);
  console.log('Created overview.png, translation-stages.png and youtube-demo.png from the real UI.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
