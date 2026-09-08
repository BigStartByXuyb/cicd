import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekClaudeConfig } from './provider-config.mjs';

test('uses DeepSeek Anthropic compatibility with V4 Flash by default', () => {
  assert.deepEqual(createDeepSeekClaudeConfig(), {
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-flash',
  });
});

test('rejects an empty or unsupported model override', () => {
  assert.throws(() => createDeepSeekClaudeConfig({ model: '' }), /model is required/);
  assert.throws(() => createDeepSeekClaudeConfig({ model: 'deepseek-chat' }), /unsupported model/);
});
