import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRefinementOutput, completedTranslationStrings, refineTranslations, refinementContext } from '../background/translator.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('only complete, delimited JSON strings are exposed',()=>{
 assert.deepEqual(completedTranslationStrings('["first", "part',8),['first']);
 assert.deepEqual(completedTranslationStrings('["first"',8),[]);
 assert.deepEqual(completedTranslationStrings('["first", 42, "third"]',8),['first']);
 assert.deepEqual(completedTranslationStrings('["bad\\q", "second"]',8),[]);
 assert.deepEqual(completedTranslationStrings('```json\n["quote: \\" and \\u4f60", "next"]\n```',8),['quote: " and 你','next']);
 assert.deepEqual(completedTranslationStrings('["one","two"]',1),['one']);
});
test('the first sentence arrives before the stream completes, including shared requests',async()=>{
 let controller,done=false;const updates=[],shared=[];
 const encoder=new TextEncoder();
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'content-type':'text/event-stream'}});
 const settings={openRouterKey:'stream-test',openRouterModel:'test',targetLang:'zh-TW'};
 const context=refinementContext(settings);
 const task=refineTranslations(['first','second'],['暫一','暫二'],context,settings,p=>updates.push(p)).then(r=>{done=true;return r;});
 const second=refineTranslations(['first','second'],['暫一','暫二'],context,settings,p=>shared.push(p));
 const send=text=>controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n'));
 await flush();send('["第一句",');await flush();
 assert.equal(done,false);assert.deepEqual(updates,[['第一句']]);assert.deepEqual(shared,updates);
 send('"第二句"]');controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();
 assert.deepEqual(await task,['第一句','第二句']);assert.deepEqual(await second,['第一句','第二句']);
});

test('single Portuguese refinement accepts explicit JSON translation envelopes and rejects misalignment', () => {
 const translated = '簡直太棒了，恭喜！';
 for (const value of [[translated], translated, { translation: translated }, { translations: [translated] }]) {
  assert.deepEqual(parseRefinementOutput(JSON.stringify(value), 1), [translated]);
 }
 for (const value of [[], ['第一句', '第二句'], { explanation: translated }, { translation: translated, translations: [translated] }, [42]]) {
  assert.throws(() => parseRefinementOutput(JSON.stringify(value), 1));
 }
 assert.throws(() => parseRefinementOutput(JSON.stringify(translated), 2));
});

test('source/draft objects from the live model require exact source alignment', () => {
 const source = 'Simplesmente maravilhosa. Os meus parabéns!';
 const output = JSON.stringify([{ source, draft: '簡直太棒了，恭喜！' }]);
 assert.deepEqual(parseRefinementOutput(output, 1, [source]), ['簡直太棒了，恭喜！']);
 assert.throws(() => parseRefinementOutput(output, 1, ['different source']));
 assert.throws(() => parseRefinementOutput(output, 1));
});
