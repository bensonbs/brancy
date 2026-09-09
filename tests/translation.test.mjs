import test from 'node:test';
import assert from 'node:assert/strict';
import { callOpenRouter } from '../background/openrouter.js';
import { translateWebTexts, translateSubtitleCues } from '../background/translator.js';

test('OpenRouter sends the exact custom model and trimmed key', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: ' OK ' } }] }) };
  };
  assert.equal(await callOpenRouter({ apiKey: ' test-key ', model: ' vendor/custom-model ', messages: [] }), 'OK');
  assert.equal(JSON.parse(request.body).model, 'vendor/custom-model');
  assert.equal(request.headers.Authorization, 'Bearer test-key');
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
});

test('blank key/model and API errors never silently select a different service', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 401, text: async () => '{"error":{"message":"Invalid key"}}' }; };
  await assert.rejects(callOpenRouter({ apiKey: ' ', model: 'custom' }), /API Key/);
  await assert.rejects(callOpenRouter({ apiKey: 'key', model: ' ' }), /模型/);
  await assert.rejects(translateWebTexts(['Hello'], { engine: 'google_api' }), /API Key/);
  await assert.rejects(translateWebTexts(['Hello'], { engine: 'openrouter', openRouterKey: 'key', openRouterModel: '' }), /模型/);
  assert.equal(calls, 0);
  await assert.rejects(translateWebTexts(['Hello'], { engine: 'openrouter', openRouterKey: 'key', openRouterModel: 'custom' }), /401/);
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

test('Google official API batches long subtitles without changing cue timing', async () => {
  let sizes = [];
  globalThis.fetch = async (url, options) => {
    assert.match(url, /translation.googleapis.com/);
    const body = JSON.parse(options.body);
    sizes.push(body.q.length);
    return { ok: true, json: async () => ({ data: { translations: body.q.map(text => ({ translatedText: `譯文 ${text}` })) } }) };
  };
  const cues = Array.from({ length: 205 }, (_, i) => ({ text: `Sentence ${i}`, start: i, duration: 1 }));
  const translated = await translateSubtitleCues(cues, { engine: 'google_api', googleApiKey: 'key' });
  assert.deepEqual(sizes, [100, 100, 5]);
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

test('large OpenRouter requests use bounded batches and preserve ordering', async () => {
  const batchSizes = [];
  globalThis.fetch = async (_, options) => {
    const texts = JSON.parse(JSON.parse(options.body).messages[1].content);
    batchSizes.push(texts.length);
    const result = texts.map(text => `譯 ${text}`);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) };
  };
  const texts = Array.from({ length: 19 }, (_, i) => `Sentence ${i}`);
  const result = await translateWebTexts(texts, { engine: 'openrouter', openRouterKey: 'key', openRouterModel: 'custom' });
  assert.deepEqual(batchSizes, [8, 8, 3]);
  assert.deepEqual(result, texts.map(text => `譯 ${text}`));
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
