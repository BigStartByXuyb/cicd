import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd(), 'projects/plugin-marketplace');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-ci-report-'));

test('builds deterministic and final reports from machine-readable inputs', () => {
  try {
    const validationPath = path.join(temp, 'validation.json');
    const deterministicJson = path.join(temp, 'deterministic.json');
    const deterministicMarkdown = path.join(temp, 'deterministic.md');
    const semanticJson = path.join(temp, 'semantic.json');
    const semanticMarkdown = path.join(temp, 'semantic.md');
    const finalJson = path.join(temp, 'final.json');
    const finalMarkdown = path.join(temp, 'final.md');
    fs.writeFileSync(validationPath, JSON.stringify({ valid: true, errors: [], plugins: [] }));
    fs.writeFileSync(semanticJson, JSON.stringify({ result: 'REVIEW', blockingFindings: 0, reviewFindings: 1, findings: [{ id: 'REVIEW-001', title: 'Needs review', severity: 'REVIEW', scope: 'example' }] }));
    fs.writeFileSync(semanticMarkdown, '# Plugin Semantic Audit\n');
    execFileSync(process.execPath, [path.join(root, 'scripts/ci/build-deterministic-report.mjs'), '--input', validationPath, '--plugins-json', '["example"]', '--output-json', deterministicJson, '--output-markdown', deterministicMarkdown]);
    execFileSync(process.execPath, [path.join(root, 'scripts/ci/build-final-report.mjs'), '--deterministic', deterministicJson, '--semantic', semanticJson, '--semantic-markdown', semanticMarkdown, '--plugins-json', '["example"]', '--output-json', finalJson, '--output-markdown', finalMarkdown]);
    const report = JSON.parse(fs.readFileSync(finalJson, 'utf8'));
    assert.equal(report.decision, 'REVIEW');
    assert.equal(report.checks.semantic.reviewFindings, 1);
    assert.match(fs.readFileSync(finalMarkdown, 'utf8'), /最终结论：\*\*REVIEW\*\*/);
    assert.match(fs.readFileSync(finalMarkdown, 'utf8'), /阻断问题：\*\*0\*\*/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// 真实回归（plugin-marketplace PR #7）：语义审计返回 INVALID 时，最终结论被渲染成 BLOCK，
// 而同一条评论里又写着「阻断问题：0」——看起来像代码被阻断。INVALID 必须是它自己的结论。
test('states INVALID as its own final decision instead of folding it into BLOCK', () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-ci-invalid-'));
  try {
    const validationPath = path.join(isolated, 'validation.json');
    const deterministicJson = path.join(isolated, 'deterministic.json');
    const deterministicMarkdown = path.join(isolated, 'deterministic.md');
    const semanticJson = path.join(isolated, 'semantic.json');
    const semanticMarkdown = path.join(isolated, 'semantic.md');
    const finalJson = path.join(isolated, 'final.json');
    const finalMarkdown = path.join(isolated, 'final.md');
    fs.writeFileSync(validationPath, JSON.stringify({ valid: true, errors: [], plugins: [] }));
    fs.writeFileSync(semanticJson, JSON.stringify({ result: 'INVALID', blockingFindings: 0, reviewFindings: 0, error: 'finding severity is invalid', findings: [] }));
    fs.writeFileSync(semanticMarkdown, '# 插件语义审计\n');
    execFileSync(process.execPath, [path.join(root, 'scripts/ci/build-deterministic-report.mjs'), '--input', validationPath, '--plugins-json', '["example"]', '--output-json', deterministicJson, '--output-markdown', deterministicMarkdown]);
    execFileSync(process.execPath, [path.join(root, 'scripts/ci/build-final-report.mjs'), '--deterministic', deterministicJson, '--semantic', semanticJson, '--semantic-markdown', semanticMarkdown, '--plugins-json', '["example"]', '--output-json', finalJson, '--output-markdown', finalMarkdown]);

    const report = JSON.parse(fs.readFileSync(finalJson, 'utf8'));
    const markdown = fs.readFileSync(finalMarkdown, 'utf8');
    assert.equal(report.decision, 'INVALID');
    assert.equal(report.checks.semantic.status, 'INVALID');
    assert.match(markdown, /最终结论：\*\*INVALID\*\*/);
    assert.match(markdown, /不是发现了阻断问题/);
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});
