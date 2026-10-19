import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekClaudeConfig } from './provider-config.mjs';

test('uses the current DeepSeek Flash API model by default', () => {
  assert.deepEqual(createDeepSeekClaudeConfig(), {
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-flash',
  });
});

test('rejects an empty or unsupported model override', () => {
  assert.throws(() => createDeepSeekClaudeConfig({ model: '' }), /model is required/);
  assert.throws(() => createDeepSeekClaudeConfig({ model: 'deepseek-chat' }), /unsupported model/);
});
