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

/*
 * 标题是给人读的：模型偶尔只写 `### [REVIEW-001]`。
 * 那仍是一条 finding —— 只因为漏写标题就把整份报告判成 INVALID，等于把格式问题当语义问题。
 */
test('accepts a finding heading without a human title', () => {
  const result = parseAuditReport(validReport.replace('### [REVIEW-001] Duplicate responsibility', '### [REVIEW-001]'));

  assert.equal(result.reviewFindings, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, 'REVIEW-001');
  assert.equal(result.findings[0].title, '');
});

/*
 * 证据的写法：单行、区间、几处都算；网址不算（那是地址，不是代码位置）。
 * 只因为把证据写成区间 `a.js:12-15` 就判 INVALID，等于把格式问题当语义问题。
 */
test('accepts line ranges as evidence and ignores urls', () => {
  const withRange = validReport.replace(
    '  - `plugins/example-plugin/skills/a/SKILL.md:10`',
    '  - `plugins/example-plugin/skills/a/SKILL.md:10-12`\n  - `plugins/example-plugin/skills/a/SKILL.md:20,24`\n  - 参考 `https://example.com:8443/x` 这一条'
  );
  const result = parseAuditReport(withRange);

  assert.equal(result.reviewFindings, 1);
  assert.deepEqual(result.findings[0].evidence, [
    'plugins/example-plugin/skills/a/SKILL.md:10-12',
    'plugins/example-plugin/skills/a/SKILL.md:20,24'
  ]);
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

// 自由作答（没有 front matter、也没有那四个小节）仍然整份拒绝：那不是报告。
// 缺 front matter 本身不再判 INVALID —— 正文的真值是 findings，摘要按它反推（见下面几条用例）。
test('rejects malformed audit output', () => {
  assert.throws(() => parseAuditReport('# free-form answer'), /audit report is missing/);
});

/*
 * 真实回归（应用套件 PR #51 连续两次 CI 变红）：模型漏写 front matter。
 * 那只是摘要缺失：按 findings 反推 result 与条数，并在 notes 里写明这处偏差。
 */
test('derives the summary when the front matter is missing', () => {
  const withoutFrontMatter = validReport.slice(validReport.indexOf('# Plugin Semantic Audit'));
  const result = parseAuditReport(withoutFrontMatter);

  assert.equal(result.result, 'REVIEW');
  assert.equal(result.reviewFindings, 1);
  assert.match(result.notes.join('\n'), /缺 front matter/);
});

// 一级标题同上：小节已经把套件认出来了，漏标题只记一条备注。
test('accepts a report without the suite heading', () => {
  const result = parseAuditReport(validReport.replace('# Plugin Semantic Audit\n', ''));

  assert.equal(result.result, 'REVIEW');
  assert.match(result.notes.join('\n'), /缺一级标题/);
});

/*
 * 证据缺失：BLOCK 必须有可查的位置（没证据的阻断不能采信）；
 * REVIEW 照收并标 evidenceMissing —— 让人自己看缺哪一条，而不是整轮 CI 判 INVALID。
 */
test('keeps a review finding that forgot its evidence, but still requires evidence on a block', () => {
  const noEvidence = validReport.replace('  - `plugins/example-plugin/skills/a/SKILL.md:10`\n', '');
  const result = parseAuditReport(noEvidence);

  assert.equal(result.reviewFindings, 1);
  assert.equal(result.findings[0].evidenceMissing, true);
  assert.match(result.notes.join('\n'), /没有给出代码位置/);

  const blocking = validReport
    .replace('result: REVIEW', 'result: BLOCK')
    .replace('blocking_findings: 0', 'blocking_findings: 1')
    .replace('review_findings: 1', 'review_findings: 0')
    .replace('### [REVIEW-001]', '### [BLOCK-001]')
    .replace('- Severity: `REVIEW`', '- Severity: `BLOCK`')
    .replace('- Confidence: `medium`', '- Confidence: `high`')
    .replace('  - `plugins/example-plugin/skills/a/SKILL.md:10`\n', '');
  assert.throws(() => parseAuditReport(blocking), /must contain evidence/);
});

// front matter 与正文条数不一致时按正文计：采信摘要会把「写了 BLOCK 却声称 0 条」悄悄放过去。
test('counts findings from the body when the front matter disagrees', () => {
  const result = parseAuditReport(validReport.replace('review_findings: 1', 'review_findings: 9'));

  assert.equal(result.reviewFindings, 1);
  assert.match(result.notes.join('\n'), /review_findings=9/);
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
