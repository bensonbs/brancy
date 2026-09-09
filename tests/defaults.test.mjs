import test from 'node:test';
import assert from 'node:assert/strict';
let installed, dispatcher, stored = {};
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener(fn) { installed = fn; } },
    onStartup: { addListener() {} }, onMessage: { addListener(fn) { dispatcher = fn; } }
  },
  contextMenus: { onClicked: { addListener() {} }, async removeAll() {}, create() {} },
  storage: { local: {
    get(defaults, callback) { callback({ ...defaults, ...stored }); },
    async remove(keys) { keys.forEach(key => delete stored[key]); },
    async set(values) { stored = { ...stored, ...values }; }
  } }
};
await import('../background/background.js');

test('fresh installation defaults to Google with the requested editable DeepSeek model', async () => {
  stored = {};
  await installed({ reason: 'install' });
  assert.equal(stored.engine, undefined);
  assert.equal(stored.openRouterKey, '');
  assert.equal(stored.openRouterModel, 'deepseek/deepseek-v4-flash-0731');
});

test('update replaces the old bundled model and preserves keys and custom models', async () => {
  stored = { openRouterModel: 'google/gemini-2.5-flash', openRouterKey: 'existing-key' };
  await installed({ reason: 'update' });
  assert.equal(stored.openRouterModel, 'deepseek/deepseek-v4-flash-0731');
  assert.equal(stored.openRouterKey, 'existing-key');
  stored.openRouterModel = 'vendor/user-model';
  await installed({ reason: 'update' });
  assert.equal(stored.openRouterModel, 'vendor/user-model');
});

test('update deletes obsolete provider selection and official Google credentials', async () => {
  stored = { engine: 'google_api', googleApiKey: 'old-key' };
  await installed({ reason: 'update' });
  assert.equal(stored.engine, undefined);
  assert.equal(stored.googleApiKey, undefined);
});

test('YouTube subtitles translate to Traditional Chinese without changing saved target language', async () => {
  stored = { targetLang: 'en', openRouterKey: '' };
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requested.push(options.body.get('tl'));
    return { ok: true, json: async () => [['你好']] };
  };
  const dispatch = message => new Promise(resolve => dispatcher(message, {}, resolve));
  try {
    const live = await dispatch({ action: 'TRANSLATE_TEXTS', youtubeSubtitle: true, texts: ['こんにちは'] });
    const timed = await dispatch({ action: 'TRANSLATE_SUBTITLES', cues: [{ text: '안녕하세요', start: 0, end: 2 }] });
    assert.equal(live.data[0], '你好');
    assert.equal(timed.data[0].translation, '你好');
    assert.deepEqual(requested, ['zh-TW', 'zh-TW']);
    assert.equal(stored.targetLang, 'en');
  } finally { globalThis.fetch = originalFetch; }
});
