import fs from 'node:fs';

import { parseAuditReport } from '../../../../projects/plugin-marketplace/scripts/ci/lib/audit-report.mjs';

/*
 * 解析 AI 审计报告（契约与插件套件同一套，解析器直接复用，不写第二份）。
 * 用法：node parse-app-audit-report.mjs --input <report.md> [--output-json <json>] [--output-markdown <md>]
 * 退出码：BLOCK / INVALID 非 0。
 */

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

/*
 * 报告格式偏差（缺 front matter、缺一级标题、finding 漏证据……）不判 INVALID，但要让人看见：
 * 接在报告正文后面，随报告一起进 PR 评论与产物。
 */
function withFormatNotes(markdown, notes) {
  if (!notes || notes.length === 0) return markdown;
  return [markdown.trimEnd(), '', '## 报告格式偏差（CI 自动记录）', '', ...notes.map((note) => `- ${note}`), ''].join('\n');
}

const reportPath = arg('--input');
if (!reportPath) throw new Error('--input is required');

let result;
let exitCode = 0;
try {
  result = parseAuditReport(fs.readFileSync(reportPath, 'utf8'), { title: '# 应用语义审计' });
}
catch (error) {
  result = { result: 'INVALID', blockingFindings: 0, reviewFindings: 0, changedPlugins: [], findings: [], error: error.message };
  exitCode = 1;
}

const outputJsonPath = arg('--output-json');
if (outputJsonPath) fs.writeFileSync(outputJsonPath, `${JSON.stringify(result, null, 2)}\n`);
const outputMarkdownPath = arg('--output-markdown');
if (outputMarkdownPath) {
  const raw = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '# 应用语义审计\n\n- 没有产出报告。\n';
  fs.writeFileSync(outputMarkdownPath, withFormatNotes(result.markdown ?? raw, result.notes));
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.result === 'BLOCK' || result.result === 'INVALID') exitCode = 1;
process.exitCode = exitCode;
