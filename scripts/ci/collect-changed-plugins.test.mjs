import test from 'node:test';
import assert from 'node:assert/strict';
import { collectChangedPlugins } from './collect-changed-plugins.mjs';

test('collects unique plugin names from changed repository paths', () => {
  assert.deepEqual(collectChangedPlugins([
    'plugins/example-plugin/.claude-plugin/plugin.json',
    'plugins/example-plugin/skills/a/SKILL.md',
    'plugins/second-plugin/README.md',
    'README.md',
  ]), ['example-plugin', 'second-plugin']);
});

test('ignores malformed plugin paths', () => {
  assert.deepEqual(collectChangedPlugins([
    'plugins/',
    'plugins/example-plugin',
    'plugins/example-plugin/README.md',
  ]), ['example-plugin']);
});
