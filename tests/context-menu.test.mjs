import test from 'node:test';
import assert from 'node:assert/strict';

let clicked, created, calls = [], available = true, hasUtils = true;
globalThis.chrome = {
  contextMenus: {
    onClicked: { addListener(fn) { clicked = fn; } },
    async removeAll() { calls.push('removeAll'); },
    create(item) { created = item; }
  },
  tabs: { async sendMessage(tabId, message, options) {
    calls.push(message.action);
    assert.equal(tabId, 42);
    assert.equal(options.frameId, 0);
    if (message.action === 'GET_PAGE_TRANSLATION_STATE' && !available) throw new Error('No receiver');
    return { success: true, isTranslated: true };
  } },
  scripting: {
    async executeScript(options) { calls.push(options.files?.join(',') || 'probe'); return [{ result: hasUtils }]; },
    async insertCSS() { calls.push('css'); }
  }
};
const { registerPageMenu, toggleTabTranslation } = await import('../background/page-translation.js');

test('registers one website-only context menu', async () => {
  calls = [];
  await registerPageMenu();
  assert.equal(typeof clicked, 'function');
  assert.equal(created.id, 'brancy-translate-page');
  assert.deepEqual(created.documentUrlPatterns, ['http://*/*', 'https://*/*']);
  assert.ok(created.contexts.includes('selection'));
  assert.deepEqual(calls, ['removeAll']);
});

test('loaded pages receive exactly one toggle and no injection', async () => {
  calls = []; available = true;
  assert.equal((await toggleTabTranslation(42)).isTranslated, true);
  assert.deepEqual(calls, ['GET_PAGE_TRANSLATION_STATE', 'TOGGLE_PAGE_TRANSLATION']);
});

test('already open pages are injected, without redeclaring existing utilities', async () => {
  calls = []; available = false; hasUtils = true;
  await toggleTabTranslation(42);
  assert.deepEqual(calls, ['GET_PAGE_TRANSLATION_STATE', 'probe', 'css', 'content/webpage/webpage.js', 'TOGGLE_PAGE_TRANSLATION']);
  calls = []; hasUtils = false;
  await toggleTabTranslation(42);
  assert.ok(calls.includes('content/common/utils.js'));
});

test('a failed toggle is never retried as another toggle', async () => {
  calls = []; available = true;
  chrome.tabs.sendMessage = async (_, message) => {
    calls.push(message.action);
    if (message.action === 'TOGGLE_PAGE_TRANSLATION') throw new Error('Tab closed');
    return { success: true };
  };
  await assert.rejects(toggleTabTranslation(42), /Tab closed/);
  assert.deepEqual(calls, ['GET_PAGE_TRANSLATION_STATE', 'TOGGLE_PAGE_TRANSLATION']);
});
