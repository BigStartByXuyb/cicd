import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawnSync } from 'node:child_process';

import { collectExports, findHardcodedPaths, findLayerViolations, findOrphanExports } from './lib/app-scan.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const WORKFLOW = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/desktop-app.yml'), 'utf8');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-cicd-test-'));
  const write = (relative, text) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  };
  write('package.json', '{ "name": "fixture", "scripts": { "test:coverage": "node --test" } }\n');
  write('server.js', 'const { createBoard } = require("./lib/board.js");\ncreateBoard({});\n');
  write('lib/board.js', 'function createBoard() { return 1; }\nfunction helper() { return 2; }\nmodule.exports = { createBoard, helper };\n');
  write('ui/package.json', '{ "name": "fixture-ui" }\n');
  write('ui/src/main.tsx', 'export const value = 1\n');
  return { root, write };
}

function runScript(script, args) {
  return execFileSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8' });
}

// 有的检查脚本「发现问题就非 0 退出」，这里要拿到输出与退出码，而不是让异常冒出来。
function runScriptRaw(script, args) {
  return spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8' });
}

test('workflow declares the jobs, pins the CI ref, and references only existing scripts', () => {
  for (const job of ['deterministic-validation:', 'runtime-tests:', 'semantic-audit:', 'final-report:', 'publish-pr-report:', 'notify-feishu:']) {
    assert.match(WORKFLOW, new RegExp(`^  ${job}`, 'm'));
  }
  assert.match(WORKFLOW, /ci_ref:/);
  assert.match(WORKFLOW, /ref:\s*\$\{\{ inputs\.ci_ref \}\}/);
  assert.match(WORKFLOW, /npm run test:coverage/);
  assert.match(WORKFLOW, /cd "\$ROOT\/ui"/, '前端单测必须真的跑起来');
  assert.match(WORKFLOW, /ui-coverage\.txt/);
  assert.match(WORKFLOW, /check-app-structure\.mjs/);
  assert.match(WORKFLOW, /build-audit-context\.mjs/);
  assert.match(WORKFLOW, /parse-app-audit-report\.mjs/);
  assert.match(WORKFLOW, /build-final-report\.mjs/);
  assert.match(WORKFLOW, /notify-feishu\.mjs/);
  assert.match(WORKFLOW, /post-pr-comment\.mjs/);
  // 缺飞书密钥不是失败：通知脚本自己跳过。
  assert.match(WORKFLOW, /FEISHU_APP_ID: \$\{\{ secrets\.FEISHU_APP_ID \}\}/);
  for (const match of WORKFLOW.matchAll(/\$CI_PROJECT_DIR\/scripts\/ci\/([a-z-]+\.mjs)/g)) {
    assert.ok(fs.existsSync(path.join(HERE, match[1])), `workflow 引用的脚本不存在：${match[1]}`);
  }
  assert.doesNotMatch(WORKFLOW, /[A-Za-z]:\\/, 'workflow 里不得出现机器专属路径');
});

test('collectExports reads both export styles', () => {
  assert.deepEqual(collectExports('module.exports = { a, b: c };').sort(), ['a', 'b']);
  assert.deepEqual(collectExports('exports.x = 1;').sort(), ['x']);
});

test('hardcoded machine paths are findings, comments are not', () => {
  const fx = fixture();
  fx.write('lib/paths.js', '// 示例：D:\\SomeProject\nconst p = "D:\\\\Project";\nmodule.exports = { p };\n');
  const findings = findHardcodedPaths({ root: fx.root, dirs: ['lib'] });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /D:\\/, '报文里要点出命中的路径前缀');
  assert.equal(findings[0].path, 'lib/paths.js');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('orphan exports are findings, externally used exports are not', () => {
  const fx = fixture();
  const findings = findOrphanExports({ root: fx.root, libDir: 'lib', searchDirs: ['server.js', 'lib', 'ui/src'] });
  assert.deepEqual(findings.map((item) => item.message.includes('helper')), [true], 'helper 没有引用，应当被报出来');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('UI importing backend implementation is a layering violation', () => {
  const fx = fixture();
  fx.write('ui/src/leak.ts', 'import { createBoard } from "../../lib/board.js"\n');
  const findings = findLayerViolations({ root: fx.root });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'ui-imports-backend');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('caller workflow pin must be a commit SHA and must match ci_ref', () => {
  const fx = fixture();
  // 这个用例只验 pin：把 lib 收拾干净，避免孤儿导出干扰结论。
  fx.write('lib/board.js', 'function createBoard() { return 1; }\nmodule.exports = { createBoard };\n');
  fx.write('.github/workflows/ci.yml', [
    'jobs:',
    '  ci:',
    '    uses: Owner/cicd/.github/workflows/desktop-app.yml@' + 'a'.repeat(40),
    '    with:',
    '      ci_ref: ' + 'b'.repeat(40),
    ''
  ].join('\n'));
  const mismatch = runScriptRaw('check-app-structure.mjs', ['--root', fx.root]);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stdout, /不一致/);

  fx.write('.github/workflows/ci.yml', [
    'jobs:',
    '  ci:',
    '    uses: Owner/cicd/.github/workflows/desktop-app.yml@main',
    '    with:',
    '      ci_ref: main',
    ''
  ].join('\n'));
  const unpinned = runScriptRaw('check-app-structure.mjs', ['--root', fx.root]);
  assert.match(unpinned.stdout, /不是 commit SHA/);

  fx.write('.github/workflows/ci.yml', [
    'jobs:',
    '  ci:',
    '    uses: Owner/cicd/.github/workflows/desktop-app.yml@' + 'a'.repeat(40),
    '    with:',
    '      ci_ref: ' + 'a'.repeat(40),
    ''
  ].join('\n'));
  assert.match(runScript('check-app-structure.mjs', ['--root', fx.root]), /结论：PASS/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('check-app-structure passes a clean fixture and fails a leaking one', () => {
  const clean = fixture();
  clean.write('lib/board.js', 'function createBoard() { return 1; }\nmodule.exports = { createBoard };\n');
  assert.match(runScript('check-app-structure.mjs', ['--root', clean.root]), /结论：PASS/);

  const leaking = fixture();
  leaking.write('lib/extra.js', 'const p = "C:\\\\Users\\\\someone";\nmodule.exports = { p };\n');
  const failed = runScriptRaw('check-app-structure.mjs', ['--root', leaking.root]);
  assert.equal(failed.status, 1, '有问题时必须非 0 退出');
  assert.match(failed.stdout, /结论：FAIL/);
  assert.match(failed.stdout, /machine|写死|硬编码|C:/);
  fs.rmSync(clean.root, { recursive: true, force: true });
  fs.rmSync(leaking.root, { recursive: true, force: true });
});

test('build-final-report maps check results to the final decision', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-final-'));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
    return file;
  };
  const run = (deterministic, semantic) => {
    const out = path.join(dir, 'final.json');
    runScript('build-final-report.mjs', [
      '--deterministic', write('det.json', deterministic),
      ...(semantic ? ['--semantic', write('sem.json', semantic)] : []),
      '--output-json', out,
      '--output-markdown', path.join(dir, 'final.md')
    ]);
    return JSON.parse(fs.readFileSync(out, 'utf8')).decision;
  };
  assert.equal(run({ status: 'PASS', checks: [], findings: [] }, { result: 'PASS', blockingFindings: 0, reviewFindings: 0 }), 'PASS');
  assert.equal(run({ status: 'PASS', checks: [], findings: [] }, { result: 'REVIEW', blockingFindings: 0, reviewFindings: 2 }), 'REVIEW');
  assert.equal(run({ status: 'PASS', checks: [], findings: [] }, { result: 'BLOCK', blockingFindings: 1, reviewFindings: 0 }), 'BLOCK');
  assert.equal(run({ status: 'PASS', checks: [], findings: [] }, { result: 'INVALID', error: 'x' }), 'INVALID');
  assert.equal(run({ status: 'FAIL', checks: [], findings: [] }, { result: 'PASS', blockingFindings: 0, reviewFindings: 0 }), 'BLOCK');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parse-app-audit-report accepts the app contract and rejects a plugin-titled report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-parse-'));
  const report = [
    '---',
    'audit_version: 2',
    'result: PASS',
    'blocking_findings: 0',
    'review_findings: 0',
    'changed_projects:',
    '  - mastergo-transcoder-gui',
    '---',
    '',
    '# 应用语义审计',
    '',
    '## 摘要',
    '',
    '本次改动只调整了测试内的临时目录清理方式，没有阻断问题。',
    '',
    '## 问题',
    '',
    '本次未发现需要处理的问题。',
    '',
    '## 非阻断观察',
    '',
    '无。',
    '',
    '## 审计限制',
    '',
    '只读会话没有执行任何命令。'
  ].join('\n');
  const reportPath = path.join(dir, 'report.md');
  fs.writeFileSync(reportPath, `${report}\n`, 'utf8');
  const output = runScript('parse-app-audit-report.mjs', ['--input', reportPath, '--output-json', path.join(dir, 'parsed.json')]);
  assert.equal(JSON.parse(output).result, 'PASS');

  const wrongTitle = path.join(dir, 'wrong.md');
  fs.writeFileSync(wrongTitle, `${report.replace('# 应用语义审计', '# 插件语义审计')}\n`, 'utf8');
  assert.throws(() => runScript('parse-app-audit-report.mjs', ['--input', wrongTitle]), /Command failed|status 1/);
  fs.rmSync(dir, { recursive: true, force: true });
});
