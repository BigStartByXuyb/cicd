import fs from 'node:fs';

/*
 * 汇总确定性检查（可多份：结构与工具链各一份）与 AI 审计，产出最终结论与中文报告。
 * 用法：node build-final-report.mjs --deterministic <json> [--deterministic <json> ...]
 *        [--semantic <json>] [--semantic-markdown <md>]
 *        --output-json <json> --output-markdown <md>
 * 同时写一份合并后的 deterministic-report.json，供通知脚本按统一的字段口径读取。
 */

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function argAll(name) {
  const values = [];
  process.argv.forEach((value, index) => {
    if (value === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

function readJson(file) {
  return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

const deterministicReports = argAll('--deterministic').map(readJson).filter(Boolean);
const deterministicStatus = deterministicReports.length === 0
  ? 'MISSING'
  : deterministicReports.every((report) => report.status === 'PASS') ? 'PASS' : 'FAIL';
const deterministicChecks = deterministicReports.flatMap((report) => report.checks ?? []);
const deterministicFindings = deterministicReports.flatMap((report) => report.findings ?? []);
const deterministic = { status: deterministicStatus, checks: deterministicChecks, findings: deterministicFindings };

const semantic = readJson(arg('--semantic'));
const semanticResult = semantic?.result ?? 'SKIPPED';
const blockingFindings = semantic?.blockingFindings ?? 0;
const reviewFindings = semantic?.reviewFindings ?? 0;
const semanticMarkdownPath = arg('--semantic-markdown');
const semanticMarkdown = semanticMarkdownPath && fs.existsSync(semanticMarkdownPath)
  ? fs.readFileSync(semanticMarkdownPath, 'utf8')
  : '（本次没有语义审计报告）';
const outputJsonPath = arg('--output-json');
const outputMarkdownPath = arg('--output-markdown');
if (!outputJsonPath || !outputMarkdownPath) throw new Error('--output-json and --output-markdown are required');

// INVALID（报告不合契约、不能采信）和 BLOCK（确实发现了阻断问题）分开命名：混成一个词会让人
// 以为代码被阻断，而同一份报告里又写着「阻断问题 0」。
const decision = deterministicStatus !== 'PASS'
  ? 'BLOCK'
  : semanticResult === 'BLOCK'
    ? 'BLOCK'
    : semanticResult === 'INVALID'
      ? 'INVALID'
      : semanticResult === 'REVIEW'
        ? 'REVIEW'
        : 'PASS';

const report = {
  decision,
  checks: {
    deterministic: { status: deterministicStatus, findings: deterministicFindings },
    semantic: { result: semanticResult, blockingFindings, reviewFindings }
  }
};
fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(`${outputJsonPath.replace(/[^/\\]*$/, '')}deterministic-report.json`, `${JSON.stringify(deterministic, null, 2)}\n`);

const markdown = [
  '---',
  `decision: ${decision}`,
  `deterministic: ${deterministicStatus}`,
  `semantic: ${semanticResult}`,
  `blocking_findings: ${blockingFindings}`,
  `review_findings: ${reviewFindings}`,
  '---',
  '',
  '# Go 服务 CI 最终报告',
  '',
  `结论：${decision}`,
  '',
  '## 确定性检查',
  '',
  `- 结论：${deterministicStatus}`,
  ...deterministicChecks.map((check) => `- ${check.status === 'PASS' ? '✅' : '❌'} ${check.title}（${check.name}）：${check.findings.length} 条`),
  ...deterministicFindings.map((item) => `  - ${item.path}:${item.line} —— ${item.message}`),
  '',
  '## 语义审计',
  '',
  `- 结论：${semanticResult}（阻断 ${blockingFindings} / 复核 ${reviewFindings}）`,
  '',
  semanticMarkdown
].join('\n');
fs.writeFileSync(outputMarkdownPath, `${markdown}\n`);
process.stdout.write(`${JSON.stringify({ decision, blockingFindings, reviewFindings })}\n`);
