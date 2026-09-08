import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuditReport } from './audit-report.mjs';

const validReport = `---
audit_version: 1
result: REVIEW
blocking_findings: 0
review_findings: 1
changed_plugins:
  - example-plugin
---

# Plugin Semantic Audit

## Summary

One review finding.

## Findings

### [REVIEW-001] Duplicate responsibility

- Severity: \`REVIEW\`
- Category: \`DUPLICATE_RESPONSIBILITY\`
- Confidence: \`medium\`
- Scope: \`example-plugin\`
- Evidence:
  - \`plugins/example-plugin/skills/a/SKILL.md:10\`
- Why it matters: The responsibilities overlap.
- Suggested resolution: Clarify the boundary.

## Non-blocking observations

None

## Audit limitations

None
`;

test('parses a valid structured Markdown audit report', () => {
  const result = parseAuditReport(validReport);

  assert.equal(result.result, 'REVIEW');
  assert.equal(result.blockingFindings, 0);
  assert.equal(result.reviewFindings, 1);
  assert.equal(result.changedPlugins[0], 'example-plugin');
  assert.equal(result.findings[0].id, 'REVIEW-001');
  assert.equal(result.findings[0].title, 'Duplicate responsibility');
});

test('normalizes a prose-wrapped fenced audit report', () => {
  const wrapped = `The audit is complete.\n\n\`\`\`markdown\n${validReport}\n\`\`\``;
  const result = parseAuditReport(wrapped);
  assert.equal(result.result, 'REVIEW');
  assert.match(result.markdown, /^---\n/);
});

test('rejects a BLOCK finding without high confidence', () => {
  const report = validReport
    .replace('result: REVIEW', 'result: BLOCK')
    .replace('blocking_findings: 0', 'blocking_findings: 1')
    .replace('review_findings: 1', 'review_findings: 0')
    .replace('### [REVIEW-001]', '### [BLOCK-001]')
    .replace('- Severity: `REVIEW`', '- Severity: `BLOCK`')
    .replace('- Confidence: `medium`', '- Confidence: `medium`');

  assert.throws(() => parseAuditReport(report), /BLOCK finding must have high confidence/);
});

test('rejects malformed audit output', () => {
  assert.throws(() => parseAuditReport('# free-form answer'), /front matter/);
});
