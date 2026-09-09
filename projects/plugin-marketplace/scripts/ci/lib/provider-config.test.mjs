import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekClaudeConfig } from './provider-config.mjs';

test('uses a Claude Code alias mapped to DeepSeek V4 Flash by default', () => {
  assert.deepEqual(createDeepSeekClaudeConfig(), {
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'claude-sonnet-4-6',
  });
});

test('rejects an empty or unsupported model override', () => {
  assert.throws(() => createDeepSeekClaudeConfig({ model: '' }), /model is required/);
  assert.throws(() => createDeepSeekClaudeConfig({ model: 'deepseek-chat' }), /unsupported model/);
});
