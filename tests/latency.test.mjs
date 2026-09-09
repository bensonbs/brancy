import test from 'node:test';
import assert from 'node:assert/strict';
import { translateWebTexts, lookupWordDetails, refineTranslations, refinementContext } from '../background/translator.js';
const flush = () => new Promise(resolve => setImmediate(resolve));

test('Google fallback runs four items at a time and preserves order despite failures', async () => {
  const pending=[]; let active=0,peak=0;
  globalThis.fetch=async url=>{
    if(url.includes('clients5'))return {ok:false,status:503};
    active++;peak=Math.max(peak,active);
    return new Promise(resolve=>pending.push({text:new URL(url).searchParams.get('q'),finish(fail=false){active--;resolve(fail?{ok:false,status:503}:{ok:true,json:async()=>[[['譯文 '+this.text]]]});}}));
  };
  const input=Array.from({length:8},(_,i)=>'source '+i);
  const task=translateWebTexts(input,{targetLang:'zh-TW'});
  await flush();assert.equal(pending.length,4);
  pending.slice().reverse().forEach((p,i)=>p.finish(i===0));
  await flush();assert.equal(pending.length,8);
  pending.slice(4).reverse().forEach(p=>p.finish());
  assert.deepEqual(await task,input.map((s,i)=>i===3?s:'譯文 '+s));
  assert.equal(peak,4);
});

test('word translation starts before the dictionary completes', async()=>{
  let translated=false,finishDictionary;
  globalThis.fetch=async url=>{
    if(url.includes('dictionaryapi'))return new Promise(resolve=>finishDictionary=()=>resolve({ok:false}));
    translated=true;return {ok:true,json:async()=>[['你好']]};
  };
  const task=lookupWordDetails('Hello',{});
  await flush();assert.equal(translated,true);
  finishDictionary();assert.equal((await task).translation,'你好');
});

test('identical OpenRouter work shares a request; completed or failed work is not retained',async()=>{
  const settings={openRouterKey:'latency-test',openRouterModel:'test/model',targetLang:'zh-TW'};
  const context=refinementContext(settings);
  let calls=0,finish;
  globalThis.fetch=async()=>{calls++;return new Promise(resolve=>finish=()=>resolve({ok:true,json:async()=>({choices:[{message:{content:'["你好"]'}}]})}));};
  const first=refineTranslations(['Hello'],['嗨'],context,settings);
  const second=refineTranslations(['Hello'],['嗨'],context,settings);
  assert.equal(calls,1);finish();
  const results=await Promise.all([first,second]);
  assert.deepEqual(results,[['你好'],['你好']]);assert.notEqual(results[0],results[1]);
  globalThis.fetch=async()=>{calls++;return {ok:false,status:503,text:async()=>'Unavailable'};};
  await assert.rejects(refineTranslations(['Hello'],['嗨'],context,settings),/503/);
  await assert.rejects(refineTranslations(['Hello'],['嗨'],context,settings),/503/);
  assert.equal(calls,3);
});

 test('Japanese source echoed by Google retries only the untranslated item', async () => {
  const source = '間のゆとりが穏やかな時間を創り出す';
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.includes('clients5')) return { ok: true, json: async () => [source, '你好'] };
    assert.equal(new URL(url).searchParams.get('q'), source);
    return { ok: true, json: async () => [[['留白營造出平靜的時光']]] };
  };
  assert.deepEqual(await translateWebTexts([source, 'Hello'], { targetLang: 'zh-TW' }), ['留白營造出平靜的時光', '你好']);
  assert.equal(calls.length, 2);
});
