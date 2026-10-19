import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const central = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/plugin-marketplace.yml'), 'utf8');
const desktop = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/desktop-app.yml'), 'utf8');
const gitlabCommon = fs.readFileSync(path.resolve(process.cwd(), 'templates/common.yml'), 'utf8');
const gitlabPluginTemplate = fs.readFileSync(path.resolve(process.cwd(), 'templates/plugin-marketplace.yml'), 'utf8');
// 调用方仓库的 workflow：本地并排放着同级的 plugin-marketplace-worktree 时直接读；
// 没有那份检出（例如只 clone 了 cicd 本身）就跳过调用方那几条断言 —— 缺检出不是契约失败。
const callerPath = process.env.CALLER_WORKFLOW ?? path.resolve(process.cwd(), '..', 'plugin-marketplace-worktree/.github/workflows/plugin-cicd.yml');
const caller = fs.existsSync(callerPath) ? fs.readFileSync(callerPath, 'utf8') : '';
const names = ['ANTHROPIC_API_KEY', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_DEFAULT_CHAT_ID', 'FEISHU_RECIPIENT_MAP_JSON'];

test('central workflow declares every required workflow-call secret', () => {
  for (const name of names) {
    assert.match(central, new RegExp(`^\\s{6}${name}:\\s*$`, 'm'));
  }
  assert.doesNotMatch(central, /environment:\s*plugin-cicd-prod/);
});

test('semantic audit uses the DeepSeek Flash Anthropic alias through Claude Code environment settings', () => {
  for (const config of [central, desktop, gitlabCommon]) {
    for (const name of [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'CLAUDE_CODE_SUBAGENT_MODEL',
    ]) {
      assert.match(config, new RegExp(`${name}:\\s*['"]?claude-sonnet-4-6`));
    }
    assert.doesNotMatch(config, /ANTHROPIC_(?:DEFAULT_\w+_)?MODEL:\s*['"]?deepseek-flash/);
    assert.match(config, /CLAUDE_CODE_MAX_OUTPUT_TOKENS:\s*['"]?64000/);
  }
  assert.match(central, /CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT:\s*['"]?1['"]?/);
});

test('GitLab JavaScript runtime tests do not install the PowerShell runtime', () => {
  const jsJob = gitlabPluginTemplate.match(/plugin:runtime-js:[\s\S]*?(?=\nplugin:|\n#)/)?.[0] ?? '';
  const pwshJob = gitlabPluginTemplate.match(/plugin:runtime-pwsh:[\s\S]*?(?=\nplugin:|\n#)/)?.[0] ?? '';
  assert.doesNotMatch(jsJob, /CI_INSTALL_PWSH/);
  assert.match(pwshJob, /CI_INSTALL_PWSH:\s*["']true/);
});

test('semantic audit reads the workspace on demand instead of inlining plugin sources', () => {
  assert.match(central, /build-audit-context\.mjs/);
  assert.doesNotMatch(central, /build-plugin-audit-bundle\.mjs/);
  assert.match(central, /--tools\s+"?Read,Grep,Glob"?/);
  assert.match(central, /--diff-output/);
  assert.doesNotMatch(central, /audit-bundle\.md/);
  const contract = fs.readFileSync(path.resolve(process.cwd(), 'projects/plugin-marketplace/docs/plugin-semantic-audit.md'), 'utf8');
  assert.match(contract, /not inlined/);
  assert.match(contract, /The runner enables only `Read`/);
  assert.doesNotMatch(contract, /`Read`, `Grep` and `Glob`/);
});

test('semantic audit contract requires Simplified Chinese version 2 reports', () => {
  const contract = fs.readFileSync(path.resolve(process.cwd(), 'projects/plugin-marketplace/docs/plugin-semantic-audit.md'), 'utf8');
  assert.match(contract, /audit_version: 2/);
  assert.match(contract, /Simplified Chinese/);
  assert.match(contract, /# 插件语义审计/);
  assert.match(contract, /## 摘要/);
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

test('semantic parser reads generated JSON, not raw Markdown', () => {
  assert.match(central, /SEMANTIC_REPORT:\s*\$\{\{ runner\.temp \}\}\/semantic-report\.json/);
  assert.match(central, /process\.env\.SEMANTIC_REPORT/);
  assert.doesNotMatch(central, /REPORT:\s*\$\{\{ runner\.temp \}\}\/audit-report\.md/);
});

test('caller passes exactly the required secret names', () => {
  if (!caller) {
    // 没检出调用方仓库：只在这里跳过，其余断言仍读本仓库的 reusable workflow。
    return;
  }
  // 调用方仓库的行尾由各自平台决定：两种行尾都要认。
  const block = caller.match(/\r?\n\s+secrets:\r?\n([\s\S]*?)(?=\r?\n\S|$)/)?.[1] ?? '';
  const actual = [...block.matchAll(/^ {6}([A-Z0-9_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(actual, names);
  assert.doesNotMatch(caller, /secrets:\s*inherit/);
});
