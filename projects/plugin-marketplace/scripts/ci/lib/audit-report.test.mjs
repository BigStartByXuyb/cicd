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

const chineseReportV2 = validReport
  .replace('audit_version: 1', 'audit_version: 2')
  .replace('# Plugin Semantic Audit', '# 插件语义审计')
  .replace('## Summary', '## 摘要')
  .replace('## Findings', '## 问题')
  .replace('## Non-blocking observations', '## 非阻断观察')
  .replace('## Audit limitations', '## 审计限制')
  .replace('One review finding.', '发现一个需要确认的问题。')
  .replace('Duplicate responsibility', '职责重复')
  .replace('The responsibilities overlap.', '职责存在重叠。')
  .replace('Clarify the boundary.', '明确职责边界。')
  .replace('- Severity:', '- 严重级别:')
  .replace('- Category:', '- 类别:')
  .replace('- Confidence:', '- 置信度:')
  .replace('- Scope:', '- 范围:');

test('parses the Chinese version 2 report contract', () => {
  const result = parseAuditReport(chineseReportV2);
  assert.equal(result.result, 'REVIEW');
  assert.equal(result.findings[0].category, 'DUPLICATE_RESPONSIBILITY');
});

test('tolerates a title and contract comment before the front matter', () => {
  // 真实回归（v1.0.169 的 main run）：模型把 `# 插件语义审计` 与 contract 注释写在
  // front matter 之前，旧实现从第一个 `---` 起切片，标题被切掉 → 误判 INVALID、
  // 整轮 CI 因“audit report is missing # 插件语义审计”失败。
  const report = `# 插件语义审计\n\n<!--\ncontract_sha256: e1ea2e0e8a7fb6dd\n-->\n\n${chineseReportV2}`;
  const result = parseAuditReport(report);

  assert.equal(result.result, 'REVIEW');
  assert.equal(result.blockingFindings, 0);
  assert.equal(result.reviewFindings, 1);
  assert.equal(result.changedPlugins[0], 'example-plugin');
  assert.equal(result.findings[0].id, 'REVIEW-001');
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

// 真实回归（plugin-marketplace PR #7 连续 4 轮 CI 变红）：模型把 `- Severity:` 写成 human 等级词
// （medium / non-blocking）或漏掉反引号，旧实现直接抛出 'finding severity is invalid' → 整份报告判 INVALID，
// 而报告自己的 front matter 明明是 `blocking_findings: 0`。kind 由 finding ID 前缀决定，字段只作人读。
test('derives the finding kind from the ID prefix when the Severity field uses a non-enum word', () => {
  const sloppy = validReport.replace('- Severity: `REVIEW`', '- Severity: non-blocking');
  const result = parseAuditReport(sloppy);

  assert.equal(result.result, 'REVIEW');
  assert.equal(result.findings[0].severity, 'REVIEW');
  assert.equal(result.reviewFindings, 1);
});

test('derives the finding kind from the ID prefix when the Severity field is missing', () => {
  const report = validReport.replace('- Severity: `REVIEW`\n', '');
  const result = parseAuditReport(report);

  assert.equal(result.findings[0].severity, 'REVIEW');
  assert.equal(result.findings[0].id, 'REVIEW-001');
});

test('rejects a Severity field that contradicts the finding ID prefix', () => {
  const report = validReport
    .replace('- Severity: `REVIEW`', '- Severity: `BLOCK`')
    .replace('- Confidence: `medium`', '- Confidence: `high`');

  assert.throws(() => parseAuditReport(report), /与 ID 前缀/);
});

// 真实回归（plugin-marketplace PR #7 的 audit7 / audit8 / audit10）：模型整组字段都没写反引号
// （`- Severity: non-blocking` / `- Confidence: medium` / `- Scope: …`）。只放宽 severity 仍会在
// confidence 上判 INVALID —— 反引号是渲染细节，不该是契约。
test('accepts bare (non-backquoted) values on every field line', () => {
  const bare = validReport
    .replace('- Severity: `REVIEW`', '- Severity: non-blocking')
    .replace('- Category: `DUPLICATE_RESPONSIBILITY`', '- Category: UNCLEAR_WORDING')
    .replace('- Confidence: `medium`', '- Confidence: medium')
    .replace('- Scope: `example-plugin`', '- Scope: example-plugin');
  const result = parseAuditReport(bare);

  assert.equal(result.findings[0].severity, 'REVIEW');
  assert.equal(result.findings[0].category, 'UNCLEAR_WORDING');
  assert.equal(result.findings[0].confidence, 'medium');
  assert.equal(result.findings[0].scope, 'example-plugin');
  assert.equal(result.findings[0].evidence.length, 1);
});

test('a BLOCK finding still requires high confidence when fields are bare', () => {
  const bare = validReport
    .replace('result: REVIEW', 'result: BLOCK')
    .replace('blocking_findings: 0', 'blocking_findings: 1')
    .replace('review_findings: 1', 'review_findings: 0')
    .replace('### [REVIEW-001]', '### [BLOCK-001]')
    .replace('- Severity: `REVIEW`', '- Severity: BLOCK')
    .replace('- Confidence: `medium`', '- Confidence: medium');

  assert.throws(() => parseAuditReport(bare), /BLOCK finding must have high confidence/);
});
