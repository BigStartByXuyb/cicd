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
