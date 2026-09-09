import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../content/youtube/youtube-page-bridge.js', import.meta.url), 'utf8');
function fixture(withCc = false, playerResponse = null) {
  const tracks = [{ languageCode: 'ko', vssId: '.ko' }, { languageCode: 'en', kind: 'asr', vssId: 'a.en' }, { languageCode: 'ko', kind: 'asr', vssId: 'a.ko' }];
  let current = tracks[0];
  const timers = new Map(), listeners = {}, selected = [], messages = [];
  let serial = 0;
  const video = { paused: false, seeking: false, readyState: 4 };
  let ccEnabled = true, ccClicks = 0;
  const cc = { getAttribute: () => String(ccEnabled), click() { ccEnabled = !ccEnabled; ccClicks++; } };
  const fetched = [];
  const player = { getPlayerResponse() { return playerResponse; }, loadModule() {}, getOption(_module, option) { return option === 'tracklist' ? tracks : current; },
    setOption(_module, _option, track) { current = track; selected.push(track); },
    querySelector(selector) { return selector === 'video' ? video : selector === '.ytp-subtitles-button' && withCc ? cc : null; } };
  const window = { fetch: async url => { fetched.push(url); const text = async () => JSON.stringify({events:[{segs:[{utf8:'こんにちは'}]}]}); return {ok:true,text,clone:()=>({text})}; },
    postMessage(msg) { messages.push(msg); }, addEventListener(name, fn) { listeners[name] = fn; } };
  class XHR { open() {} send() {} }
  const location = { origin:'https://www.youtube.com', href: 'https://www.youtube.com/watch?v=korean', search: '?v=korean' };
  vm.runInNewContext(source, { window, document: { getElementById: () => player }, location, XMLHttpRequest: XHR,
    URL, URLSearchParams, AbortSignal, console: { log() {}, warn() {} }, setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); } });
  return { fetched, messages, selected, tracks, timers, video, window, location, listeners, get ccClicks() { return ccClicks; }, tick() { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); } };
}
test('failed captions report a load error without changing the user CC language', () => {
  const f = fixture(); f.tick();
  assert.equal(f.selected.length, 0);
  assert.equal(f.messages.at(-1).action, 'CAPTION_LOAD_FAILED');
  assert.equal(f.timers.size, 0);
});
test('valid native captions cancel recovery', async () => {
  const f = fixture();
  await f.window.fetch('https://www.youtube.com/api/timedtext?v=korean');
  await Promise.resolve();
  assert.equal(f.timers.size, 0);
  assert.equal(f.selected.length, 0);
});
test('paused playback waits instead of reporting load failure', () => {
  const f = fixture(); f.video.paused = true; f.tick();
  assert.equal(f.selected.length, 0);
  f.video.paused = false; f.tick();
  assert.equal(f.selected.length, 0);
  assert.equal(f.messages.at(-1).action, 'CAPTION_LOAD_FAILED');
});
test('navigation cancels recovery for the previous video', () => {
  const f = fixture(); f.location.search = '?v=next'; f.listeners['yt-navigate-start']();
  assert.equal(f.timers.size, 0);
  assert.equal(f.selected.length, 0);
});

test('stalled CC restarts only once and never selects a different track', () => {
  const f = fixture(true); f.tick();
  assert.equal(f.ccClicks, 2);
  assert.equal(f.selected.length, 0);
  f.tick();
  assert.equal(f.ccClicks, 2);
  assert.equal(f.selected.length, 0);
  assert.equal(f.messages.at(-1).action, 'CAPTION_LOAD_FAILED');
});

for (const language of ['ja', 'ko', 'en']) test(`startup and recovery preserve ${language} CC language`, () => {
  const f = fixture(true); f.tracks[0].languageCode = language;
  f.tick(); f.tick();
  assert.equal(f.selected.length, 0);
  assert.equal(f.ccClicks, 2);
});

test('Japanese ASR is the original when an unrelated manual Vietnamese track is also available', async () => {
  const f = fixture(true, {videoDetails:{videoId:'korean'}, captions:{playerCaptionsTracklistRenderer:{
    audioTracks:[{captionTrackIndices:[1,0]}], defaultAudioTrackIndex:0,
    captionTracks:[{languageCode:'ja',kind:'asr',vssId:'a.ja',baseUrl:'https://www.youtube.com/api/timedtext?v=korean&lang=ja'},
      {languageCode:'vi',vssId:'.vi',baseUrl:'https://www.youtube.com/api/timedtext?v=korean&lang=vi'}]
  }}});
  assert.equal(f.messages.find(m=>m.action==='CAPTION_TRACKS_FOUND').tracks.find(t=>t.original).languageCode,'ja');
  await f.window.fetch('https://www.youtube.com/api/timedtext?v=korean&lang=vi');
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.fetched.some(url=>url.includes('lang=ja')));
  assert.equal(f.messages.find(m=>m.action==='NATIVE_TIMEDTEXT_CAPTURED').languageCode,'ja');
  assert.equal(f.selected.length,0);
});

test('en-US audio maps to an available en caption track', async () => {
  const f = fixture(true, {videoDetails:{videoId:'korean'}, captions:{playerCaptionsTracklistRenderer:{
    audioTracks:[{audioTrackId:'en-US.4',captionTrackIndices:[0]}], defaultAudioTrackIndex:0,
    captionTracks:[{languageCode:'en',kind:'asr',vssId:'a.en',baseUrl:'https://www.youtube.com/api/timedtext?v=korean&lang=en'}]
  }}});
  assert.equal(f.messages.find(m=>m.action==='CAPTION_TRACKS_FOUND').tracks[0].original,true);
  await f.window.fetch('https://www.youtube.com/api/timedtext?v=korean&lang=en');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.messages.find(m=>m.action==='NATIVE_TIMEDTEXT_CAPTURED').languageCode,'en');
  assert.equal(f.fetched.length,1);
  assert.equal(f.selected.length,0);
});
