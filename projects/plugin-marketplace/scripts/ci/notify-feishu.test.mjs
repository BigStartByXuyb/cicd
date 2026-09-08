import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const script = path.resolve(process.cwd(), 'projects/plugin-marketplace/scripts/ci/notify-feishu.mjs');
const input = path.resolve(process.cwd(), 'projects/plugin-marketplace/scripts/ci/fixtures/feishu-input.example.json');

test('invalid recipient mapping falls back to the default chat in dry-run mode', () => {
  const result = spawnSync(process.execPath, [script, '--input', input, '--dry-run'], {
    env: { ...process.env, FEISHU_RECIPIENT_MAP_JSON: '{invalid' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /useDefaultChat/);
  assert.match(result.stdout, /收件人映射缺失：bob/);
});
