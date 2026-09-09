import test from 'node:test';
import assert from 'node:assert/strict';
import { callOpenRouter } from '../background/openrouter.js';
import { translateWebTexts, translateSubtitleCues, refinementContext, refineTranslations } from '../background/translator.js';

test('OpenRouter sends the exact custom model and trimmed key', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: ' OK ' } }] }) };
  };
  assert.equal(await callOpenRouter({ apiKey: ' test-key ', model: ' vendor/custom-model ', messages: [] }), 'OK');
  assert.equal(JSON.parse(request.body).model, 'vendor/custom-model');
  assert.deepEqual(JSON.parse(request.body).reasoning, { enabled: false });
  assert.deepEqual(JSON.parse(request.body).provider, { sort: "latency", preferred_min_throughput: 50 });
  assert.equal(request.headers.Authorization, 'Bearer test-key');
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
});

test('blank key/model and API errors never silently select a different service', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 401, text: async () => '{"error":{"message":"Invalid key"}}' }; };
  await assert.rejects(callOpenRouter({ apiKey: ' ', model: 'custom' }), /API Key/);
  await assert.rejects(callOpenRouter({ apiKey: 'key', model: ' ' }), /模型/);
  assert.equal(calls, 0);
  await assert.rejects(callOpenRouter({ apiKey: 'key', model: 'custom' }), /401/);
  assert.equal(calls, 1);
});

test('Google is the default, preserves batch order and target language', async () => {
  globalThis.fetch = async (url, options) => {
    assert.match(url, /clients5.google.com/);
    assert.deepEqual(options.body.getAll('q'), ['Hello', 'Goodbye']);
    assert.equal(options.body.get('tl'), 'zh-TW');
    return { ok: true, json: async () => [['你好', 'en'], ['再見', 'en']] };
  };
  assert.deepEqual(await translateWebTexts(['Hello', 'Goodbye'], {}), ['你好', '再見']);
});

test('Google first pass batches long subtitles without changing cue timing', async () => {
  let sizes = [];
  globalThis.fetch = async (url, options) => {
    assert.match(url, /clients5.google.com/);
    const texts = options.body.getAll('q');
    sizes.push(texts.length);
    return { ok: true, json: async () => texts.map(text => [`譯文 ${text}`, 'en']) };
  };
  const cues = Array.from({ length: 205 }, (_, i) => ({ text: `Sentence ${i}`, start: i, duration: 1 }));
  const translated = await translateSubtitleCues(cues, { engine: 'openrouter', openRouterKey: 'key', openRouterModel: 'custom' });
  assert.deepEqual(sizes, [40, 40, 40, 40, 40, 5]);
  assert.equal(translated[204].start, 204);
  assert.equal(translated[204].translation, '譯文 Sentence 204');
});

function streamResponse(text, sliceSize = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += sliceSize) controller.enqueue(bytes.slice(i, i + sliceSize));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('streaming accepts heartbeats, split UTF-8 and CRLF event boundaries', async () => {
  globalThis.fetch = async (_, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return streamResponse(': OPENROUTER PROCESSING\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"，世界"}}]}\n\ndata: [DONE]\n\n', 1);
  };
  assert.equal(await callOpenRouter({ apiKey: 'key', model: 'custom', messages: [] }), '你好，世界');
});

test('streaming errors and truncated streams are rejected, never cached as success', async () => {
  globalThis.fetch = async () => streamResponse('data: {"error":{"message":"Provider disconnected"}}\n\n');
  await assert.rejects(callOpenRouter({ apiKey: 'key', model: 'custom' }), /Provider disconnected/);
  globalThis.fetch = async () => streamResponse('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n');
  await assert.rejects(callOpenRouter({ apiKey: 'key', model: 'custom' }), /連線中斷/);
});

test('slow streams get the extended timeout; an actual deadline still aborts', async () => {
  globalThis.fetch = async (_, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  await assert.rejects(callOpenRouter({ apiKey: 'key', model: 'custom', timeoutMs: 20 }), /逾時/);
});

test('refinement is enabled only with a configured key and model', () => {
  assert.equal(refinementContext({}), null);
  assert.equal(refinementContext({ openRouterKey: ' ', openRouterModel: 'custom' }), null);
  assert.deepEqual(refinementContext({ openRouterKey: 'key', openRouterModel: ' custom ' }), { model: 'custom', targetLang: 'zh-TW' });
});

test('second pass uses original and Google draft, exact model, and strict output validation', async () => {
  const settings = { openRouterKey: 'key', openRouterModel: 'custom', targetLang: 'ja' };
  const context = refinementContext(settings);
  let output = '["改善した訳"]';
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'custom');
    assert.deepEqual(JSON.parse(body.messages[1].content), [{ source: 'Hello', draft: 'こんにちは' }]);
    return { ok: true, json: async () => ({ choices: [{ message: { content: output } }] }) };
  };
  assert.deepEqual(await refineTranslations(['Hello'], ['こんにちは'], context, settings), ['改善した訳']);
  for (const invalid of ['[]', '[""]', '["one", "two"]', '{}']) {
    output = invalid;
    await assert.rejects(refineTranslations(['Hello'], ['こんにちは'], context, settings), /格式/);
  }
  await assert.rejects(refineTranslations(['Hello'], ['こんにちは'], { ...context, targetLang: 'en' }, settings), /設定已變更/);
  await assert.rejects(refineTranslations(Array(9).fill('Hello'), [], context, settings), /格式/);
});

test('subtitle cache cannot replace a current track with stale text or timestamps', async () => {
  const previousChrome = globalThis.chrome;
  const cached = [{ text: 'Hello', start: 90, end: 91, translation: '舊字幕' }];
  globalThis.chrome = { storage: { local: {
    get([key], callback) { callback({ [key]: cached }); },
    set(_, callback) { callback(); }, remove(_, callback) { callback(); }
  } } };
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, json: async () => [['你好', 'en']] };
  };
  try {
    const result = await translateSubtitleCues([{ text: 'Hello', start: 1, end: 2 }], {}, 'video');
    assert.equal(requests, 1);
    assert.deepEqual(result, [{ text: 'Hello', start: 1, end: 2, translation: '你好' }]);
  } finally { globalThis.chrome = previousChrome; }
});

test('overlapping subtitle windows reuse individual cues and keep source metadata', async () => {
  const previousChrome = globalThis.chrome;
  const stored = {};
  globalThis.chrome = { storage: { local: {
    get(keys, callback) { callback(Object.fromEntries(keys.map(key => [key, stored[key]]))); },
    set(entries, callback) { Object.assign(stored, entries); callback(); }
  } } };
  const requests = [];
  globalThis.fetch = async (_, options) => {
    const texts = options.body.getAll('q'); requests.push(texts);
    return { ok: true, json: async () => texts.map(text => [`譯 ${text}`, 'en']) };
  };
  const cues = Array.from({ length: 3 }, (_, i) => ({ id: i, text: `Cue ${i}`, start: i * 3, end: i * 3 + 3 }));
  try {
    await translateSubtitleCues(cues.slice(0, 2), {}, 'video');
    const second = await translateSubtitleCues(cues.slice(1).map(cue => ({ ...cue, id: cue.id + 10 })), {}, 'video');
    assert.deepEqual(requests, [['Cue 0', 'Cue 1'], ['Cue 2']]);
    assert.equal(second[0].id, 11);
    assert.equal(second[0].translation, '譯 Cue 1');
    await translateSubtitleCues(cues.slice(0, 1), { targetLang: 'ja' }, 'video');
    await translateSubtitleCues([{ ...cues[0], start: 99, end: 100 }], {}, 'video');
    assert.equal(requests.length, 4, 'language and source clock changes bypass old cache');
    assert.equal(Object.keys(stored).length, 5);
  } finally { globalThis.chrome = previousChrome; }
});

test('concurrent subtitle batches cannot overwrite each other in the cache', async () => {
  const previousChrome = globalThis.chrome;
  const stored = {};
  globalThis.chrome = { storage: { local: {
    get(keys, callback) { callback(Object.fromEntries(keys.map(key => [key, stored[key]]))); },
    set(entries, callback) { Object.assign(stored, entries); callback(); }
  } } };
  globalThis.fetch = async (_, options) => ({ ok: true, json: async () => options.body.getAll('q').map(text => [`譯 ${text}`, 'en']) });
  const cues = [{ text: 'First', start: 0, end: 1 }, { text: 'Second', start: 1, end: 2 }];
  try {
    await Promise.all(cues.map(cue => translateSubtitleCues([cue], {}, 'video')));
    globalThis.fetch = () => { throw new Error('cached cues should not call Google again'); };
    assert.deepEqual((await translateSubtitleCues(cues, {}, 'video')).map(cue => cue.translation), ['譯 First', '譯 Second']);
    assert.equal(Object.keys(stored).length, 2);
  } finally { globalThis.chrome = previousChrome; }
});
