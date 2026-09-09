import test from 'node:test';
import assert from 'node:assert/strict';
let installed, stored = {};
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener(fn) { installed = fn; } },
    onStartup: { addListener() {} }, onMessage: { addListener() {} }
  },
  contextMenus: { onClicked: { addListener() {} }, async removeAll() {}, create() {} },
  storage: { local: {
    get(defaults, callback) { callback({ ...defaults, ...stored }); },
    async set(values) { stored = { ...stored, ...values }; }
  } }
};
await import('../background/background.js');

test('fresh installation defaults to Google with the requested editable DeepSeek model', async () => {
  stored = {};
  await installed({ reason: 'install' });
  assert.equal(stored.engine, 'google_free');
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
