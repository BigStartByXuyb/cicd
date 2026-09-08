import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const central = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/plugin-marketplace.yml'), 'utf8');
const caller = fs.readFileSync(path.resolve(process.cwd(), '..', 'plugin-marketplace-worktree/.github/workflows/plugin-cicd.yml'), 'utf8');
const names = ['ANTHROPIC_API_KEY', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_DEFAULT_CHAT_ID', 'FEISHU_RECIPIENT_MAP_JSON'];

test('central workflow declares every required workflow-call secret', () => {
  for (const name of names) {
    assert.match(central, new RegExp(`^\\s{6}${name}:\\s*$`, 'm'));
  }
  assert.doesNotMatch(central, /environment:\s*plugin-cicd-prod/);
});

test('semantic audit permits the configured DeepSeek model alias', () => {
  assert.match(central, /CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT:\s*['"]?1['"]?/);
});

test('workflow publishes one structured final report for every outcome', () => {
  assert.match(central, /final-report:/);
  assert.match(central, /plugin-deterministic-report-\$\{\{ github\.run_id \}\}/);
  assert.match(central, /plugin-final-report-\$\{\{ github\.run_id \}\}/);
  assert.match(central, /GITHUB_STEP_SUMMARY/);
  assert.match(central, /BLOCKING_FINDINGS:/);
  assert.match(central, /REVIEW_FINDINGS:/);
  assert.doesNotMatch(central, /blockingFindings:0,reviewFindings:0/);
});

test('caller passes exactly the required secret names', () => {
  const block = caller.match(/\n\s+secrets:\n([\s\S]*?)(?=\n\S|$)/)?.[1] ?? '';
  const actual = [...block.matchAll(/^\s{6}([A-Z0-9_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(actual, names);
  assert.doesNotMatch(caller, /secrets:\s*inherit/);
});
