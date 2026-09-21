import fs from 'node:fs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function readJson(path) {
  return path && fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null;
}

const deterministic = readJson(arg('--deterministic'));
const semantic = readJson(arg('--semantic'));
const semanticMarkdownPath = arg('--semantic-markdown');
const outputJsonPath = arg('--output-json');
const outputMarkdownPath = arg('--output-markdown');
const changedPlugins = JSON.parse(arg('--plugins-json', '[]'));
if (!outputJsonPath || !outputMarkdownPath) throw new Error('--output-json and --output-markdown are required');

const deterministicStatus = deterministic?.status ?? 'MISSING';
const semanticResult = semantic?.result ?? 'SKIPPED';
// INVALID（报告不合契约、不能采信）与 BLOCK（确实发现了阻断问题）是两回事：
// 混成同一个结论会让人以为代码被阻断，而同一份报告里又写着「阻断问题：0」。
// 检查仍然失败（由语义审计 job 的退出码决定），只是结论名如实反映原因。
const decision = deterministicStatus !== 'PASS'
  ? 'BLOCK'
  : semanticResult === 'BLOCK'
    ? 'BLOCK'
    : semanticResult === 'INVALID'
      ? 'INVALID'
      : semanticResult === 'REVIEW' || semanticResult === 'SKIPPED'
        ? 'REVIEW'
        : 'PASS';
const report = {
  schemaVersion: 1,
  kind: 'plugin-ci-final',
  decision,
  changedPlugins,
  checks: {
    deterministic: { status: deterministicStatus, errors: deterministic?.errors?.length ?? null },
    semantic: {
      status: semanticResult,
      blockingFindings: semantic?.blockingFindings ?? 0,
      reviewFindings: semantic?.reviewFindings ?? 0,
      error: semantic?.error ?? null,
    },
  },
  findings: semantic?.findings ?? [],
};
const semanticMarkdown = semanticMarkdownPath && fs.existsSync(semanticMarkdownPath)
  ? fs.readFileSync(semanticMarkdownPath, 'utf8').trim()
  : '## Semantic Audit\n\n- Audit was skipped or did not produce a structured report.';
const findingLines = report.findings.length
  ? report.findings.map((finding) => `- **${finding.id ?? finding.severity}** ${finding.title ?? ''}（范围：${finding.scope ?? '未知'}）`).join('\n')
  : '- 无';
const markdown = [
  '# 插件 CI/CD 报告',
  '',
  `- 最终结论：**${report.decision}**`,
  `- 变更插件：${changedPlugins.join(', ') || '无'}`,
  '',
  '## 检查结果',
  '',
  `- 结构与配置检查：**${deterministicStatus}**`,
  `- 语义审计：**${semanticResult}**`,
  `- 阻断问题：**${report.checks.semantic.blockingFindings}**`,
  `- 待确认问题：**${report.checks.semantic.reviewFindings}**`,
  ...(report.checks.semantic.error ? [`- 语义审计失败原因：**${report.checks.semantic.error}**`] : []),
  ...(semanticResult === 'INVALID'
    ? ['- 说明：`INVALID` 表示审计报告不合契约、无法采信，**不是发现了阻断问题**——检查因报告不可信而失败，请重跑语义审计或按上一条原因修报告格式。']
    : []),
  '',
  '## 发现的问题',
  '',
  findingLines,
  '',
  '## 语义审计详情',
  '',
  semanticMarkdown,
  '',
].join('\n');

fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(outputMarkdownPath, markdown);
