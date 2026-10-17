import test from 'node:test';
import assert from 'node:assert/strict';

import { sendFeishuText } from './feishu-send.mjs';

test('missing Feishu credentials skip delivery without making a request', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('fetch must not run when credentials are absent');
  };
  try {
    const result = await sendFeishuText({ markdown: 'report' });
    assert.equal(result.skipped, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
