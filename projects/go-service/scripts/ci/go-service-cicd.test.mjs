import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const TEMPLATE = fs.readFileSync(path.join(REPO_ROOT, 'templates/go-service.yml'), 'utf8');
const ROOT_CI = fs.readFileSync(path.join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');
const COMMON = fs.readFileSync(path.join(REPO_ROOT, 'templates/common.yml'), 'utf8');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'go-service-cicd-'));
  const write = (relative, text) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  };
  write('go.mod', 'module example.com/svc\n\ngo 1.22\n');
  write('AGENTS.md', '# 规范\n');
  write('.gitlab-ci.yml', [
    'stages: [dispatch]',
    'go:central-ci:',
    '  trigger:',
    '    project: data_ai/cicd',
    '  variables:',
    '    CALLER_CI_SUITE: go-service',
    ''
  ].join('\n'));
  write('cmd/svc-agent/main.go', 'package main\n\nfunc main() {}\n');
  write('internal/center/center.go', 'package center\n');
  return { root, write };
}

function runScript(script, args) {
  return execFileSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8' });
}

// 有的检查脚本「发现问题就非 0 退出」，这里要拿到输出与退出码，而不是让异常冒出来。
function runScriptRaw(script, args) {
  return spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8' });
}

test('template declares the jobs and the central pipeline registers go-service', () => {
  for (const job of ['go:structure:', 'go:toolchain:', 'go:runtime-tests:', 'go:coverage-gate:', 'go:semantic-audit:', 'go:final-report:', 'go:mr-note:', 'go:notify-feishu:']) {
    assert.match(TEMPLATE, new RegExp(`^${job}`, 'm'));
  }
  assert.match(ROOT_CI, /templates\/go-service\.yml/);
  assert.match(COMMON, /\$CALLER_CI_SUITE == "go-service"/);
  assert.match(COMMON, /go-service:data_ai\/svc_monitor/);
  assert.match(COMMON, /\.ci-go:/);
  // 模板引用的脚本必须存在：漏一个文件，流水线会在运行到那一步时才炸。
  for (const match of TEMPLATE.matchAll(/\$CI_SUITE\/scripts\/ci\/([a-z-]+\.mjs)/g)) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'projects/go-service/scripts/ci', match[1])), `模板引用的脚本不存在：${match[1]}`);
  }
  assert.doesNotMatch(TEMPLATE, /[A-Za-z]:\\/, '模板里不得出现机器专属路径');
});

test('check-go-structure passes a clean fixture and fails each violation', () => {
  const clean = fixture();
  assert.match(runScript('check-go-structure.mjs', ['--root', clean.root]), /结论：PASS/);

  const reverse = fixture();
  reverse.write('internal/protocol/protocol.go', 'package protocol\n\nimport "example.com/svc/internal/center"\n');
  const reverseRun = runScriptRaw('check-go-structure.mjs', ['--root', reverse.root]);
  assert.equal(reverseRun.status, 1);
  assert.match(reverseRun.stdout, /反向依赖/);

  const misplaced = fixture();
  misplaced.write('internal/tool/main.go', 'package main\n\nfunc main() {}\n');
  const misplacedRun = runScriptRaw('check-go-structure.mjs', ['--root', misplaced.root]);
  assert.equal(misplacedRun.status, 1);
  assert.match(misplacedRun.stdout, /package main 只允许出现在 cmd\//);

  const hardcoded = fixture();
  hardcoded.write('cmd/svc-agent/path.go', 'package main\n\nconst workdir = "D:\\\\app"\n');
  const hardcodedRun = runScriptRaw('check-go-structure.mjs', ['--root', hardcoded.root]);
  assert.equal(hardcodedRun.status, 1);
  assert.match(hardcodedRun.stdout, /Windows 盘符路径/);

  const wrongDispatch = fixture();
  wrongDispatch.write('.gitlab-ci.yml', 'stages: [dispatch]\n');
  const wrongDispatchRun = runScriptRaw('check-go-structure.mjs', ['--root', wrongDispatch.root]);
  assert.equal(wrongDispatchRun.status, 1);
  assert.match(wrongDispatchRun.stdout, /data_ai\/cicd/);

  for (const item of [clean, reverse, misplaced, hardcoded, wrongDispatch]) fs.rmSync(item.root, { recursive: true, force: true });
});

test('coverage-gate enforces overall and per-package thresholds', () => {
  const pass = fixture();
  const passCoverage = [
    'mode: atomic',
    'example.com/svc/internal/a/a.go:1.1,3.2 4 1',
    'example.com/svc/internal/a/a.go:5.1,6.2 1 0',
    'example.com/svc/cmd/svc-agent/main.go:1.1,2.2 2 0',
    ''
  ].join('\n');
  const passFile = path.join(pass.root, 'coverage.out');
  fs.writeFileSync(passFile, passCoverage, 'utf8');
  const passRun = runScriptRaw('coverage-gate.mjs', ['--file', passFile, '--root', pass.root, '--output-json', path.join(pass.root, 'report.json')]);
  assert.equal(passRun.status, 0);
  assert.match(passRun.stdout, /结论：PASS/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pass.root, 'report.json'), 'utf8')).overall, 80);

  const fail = fixture();
  const failFile = path.join(fail.root, 'coverage.out');
  fs.writeFileSync(failFile, 'mode: atomic\nexample.com/svc/internal/a/a.go:1.1,3.2 4 0\n', 'utf8');
  const failRun = runScriptRaw('coverage-gate.mjs', ['--file', failFile, '--root', fail.root]);
  assert.equal(failRun.status, 1);
  assert.match(failRun.stdout, /结论：FAIL/);

  const missing = fixture();
  const missingRun = runScriptRaw('coverage-gate.mjs', ['--file', path.join(missing.root, 'absent.out'), '--root', missing.root]);
  assert.equal(missingRun.status, 1);
  assert.match(missingRun.stdout, /覆盖率报告里没有/);

  for (const item of [pass, fail, missing]) fs.rmSync(item.root, { recursive: true, force: true });
});

test('build-final-report merges multiple deterministic reports and maps the decision', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-final-'));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
    return file;
  };
  const run = (reports, semantic) => {
    const out = path.join(dir, 'final.json');
    runScript('build-final-report.mjs', [
      ...reports.flatMap((report, index) => ['--deterministic', write(`det-${index}.json`, report)]),
      ...(semantic ? ['--semantic', write('sem.json', semantic)] : []),
      '--output-json', out,
      '--output-markdown', path.join(dir, 'final.md')
    ]);
    return JSON.parse(fs.readFileSync(out, 'utf8')).decision;
  };
  const pass = { status: 'PASS', checks: [], findings: [] };
  const fail = { status: 'FAIL', checks: [], findings: [] };
  assert.equal(run([pass, pass], { result: 'PASS', blockingFindings: 0, reviewFindings: 0 }), 'PASS');
  assert.equal(run([pass, pass], { result: 'REVIEW', blockingFindings: 0, reviewFindings: 2 }), 'REVIEW');
  assert.equal(run([pass, pass], { result: 'BLOCK', blockingFindings: 1, reviewFindings: 0 }), 'BLOCK');
  assert.equal(run([pass, fail], { result: 'PASS', blockingFindings: 0, reviewFindings: 0 }), 'BLOCK');
  assert.equal(run([pass, pass], { result: 'INVALID', error: 'x' }), 'INVALID');
  assert.equal(run([], { result: 'PASS', blockingFindings: 0, reviewFindings: 0 }), 'BLOCK');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parse-go-audit-report accepts the Go contract and rejects another suite title', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-parse-'));
  const report = [
    '---',
    'audit_version: 2',
    'result: PASS',
    'blocking_findings: 0',
    'review_findings: 0',
    'changed_projects:',
    '  - svc_monitor',
    '---',
    '',
    '# Go 服务语义审计',
    '',
    '## 摘要',
    '',
    '本次改动只调整了驱动测试的假执行器，没有阻断问题。',
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
  const output = runScript('parse-go-audit-report.mjs', ['--input', reportPath, '--output-json', path.join(dir, 'parsed.json')]);
  assert.equal(JSON.parse(output).result, 'PASS');

  const wrongTitle = path.join(dir, 'wrong.md');
  fs.writeFileSync(wrongTitle, `${report.replace('# Go 服务语义审计', '# 应用语义审计')}\n`, 'utf8');
  assert.throws(() => runScript('parse-go-audit-report.mjs', ['--input', wrongTitle]), /Command failed|status 1/);
  fs.rmSync(dir, { recursive: true, force: true });
});
