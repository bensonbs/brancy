import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../content/youtube/youtube.js', import.meta.url), 'utf8');
async function fixture() {
  const listeners = {}, elements = new Map();
  function element(id = '') {
    const classes = new Set();
    const node = { id, style: {}, textContent: '', children: [],
      classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); }, toggle(v, on) { on ? classes.add(v) : classes.delete(v); } },
      addEventListener() {}, querySelector(selector) { return elements.get(selector) || null; },
      appendChild(child) { child.parentElement = node; node.children.push(child); elements.set('#'+child.id,child); },
      contains(child) { return node.children.includes(child); }, remove() {} };
    Object.defineProperty(node, 'innerHTML', { set() { for (const name of ['ot-sub-box','ot-target-line','ot-origin-line','ot-sub-stage']) elements.set('.'+name, element(name)); } });
    return node;
  }
  const player = element('movie_player');
  const video = element('video'); Object.assign(video,{ currentTime:1,paused:false,seeking:false });
  elements.set('video', video); elements.set('video.html5-main-video',video);
  const window = { addEventListener(name, fn) { (listeners[name] ||= []).push(fn); }, removeEventListener() {},
    BrancyUtils: { async getSettings() { return {youtubeSubtitleEnabled:true}; }, debounce(fn) { return fn; }, stripSubtitleAnnotations(t) {return t || '';}, translationStageLabel(stage) { return stage === 'google-only' ? '' : 'Google 暫譯'; } },
    BrancyCaptions: { async fetchCaptionsForCurrentVideo() {return [];} }, location:{search:'?v=test'} };
  const document = { readyState:'complete',body:element(),activeElement:{tagName:'BODY'},
    getElementById(id) {return id==='movie_player' ? player : elements.get('#'+id);},
    querySelector() {return null;}, createElement:()=>element(), addEventListener() {} };
  vm.runInNewContext(source,{window,document,chrome:{storage:{onChanged:{addListener(){}}}},URLSearchParams,AbortController,
    MutationObserver:class {observe(){} disconnect(){}},setTimeout,clearTimeout,console});
  await window.BrancyYouTube.ready;
  const emit = (name, detail) => listeners[name]?.forEach(fn=>fn({detail}));
  return {elements, emit, cue(cue) { emit('brancy:cues-ready',{videoId:'test',cues:[{start:0,end:5,text:'こんにちは',...cue}]}); },
    get status() {return elements.get('.ot-sub-stage').textContent;} };
}
test('loading, pending translation, successful translation and failure remain distinguishable', async () => {
  const f = await fixture();
  assert.equal(f.status,'正在載入字幕…');
  f.cue({}); assert.equal(f.status,'正在翻譯…');
  f.cue({translation:'你好',translationState:'done'});
  assert.equal(f.elements.get('.ot-origin-line').textContent,'こんにちは');
  assert.equal(f.elements.get('.ot-target-line').textContent,'你好');
  assert.equal(f.elements.get('.ot-sub-box').classList.contains('ot-origin-first'),true);
  f.cue({translation:'你好',translationStatus:'正在翻譯…'});
  assert.match(f.status,/正在翻譯/);
  assert.doesNotMatch(f.status,/錯誤|未完成/);
  f.cue({translationState:'error',translationStatus:'HTTP 503'});
  assert.match(f.status,/翻譯錯誤.*503/);
  assert.equal(f.elements.get('.ot-origin-line').textContent,'こんにちは');
});
test('no source captions show a visible failure rather than a blank overlay', async () => {
  const f = await fixture();
  f.emit('brancy:caption-status',{videoId:'test',status:'字幕載入逾時'});
  assert.equal(f.status,'字幕載入逾時');
  assert.equal(f.elements.get('.ot-sub-box').classList.contains('visible'),true);
});
test('a stale video status never replaces current subtitles', async () => {
  const f=await fixture(); f.cue({translation:'你好'});
  f.emit('brancy:caption-status',{videoId:'previous',status:'字幕載入失敗'});
  assert.equal(f.status,'Google 暫譯');
});

test('Google-only subtitles hide the label but still show pending and failure status', async () => {
  const f = await fixture();
  f.cue({translation:'你好',translationStage:'google-only'});
  assert.equal(f.status, '');
  assert.equal(f.elements.get('.ot-sub-stage').style.display, 'none');
  f.cue({translation:'你好',translationStage:'google-only',translationStatus:'正在翻譯…'});
  assert.equal(f.status, '正在翻譯…');
  assert.equal(f.elements.get('.ot-sub-stage').style.display, '');
  f.cue({translationStage:'google-only',translationState:'error',translationStatus:'HTTP 503'});
  assert.match(f.status, /翻譯錯誤.*503/);
});
