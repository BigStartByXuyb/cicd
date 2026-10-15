import fs from 'node:fs';
import { parseAuditReport } from './lib/audit-report.mjs';

const reportPath = process.argv[process.argv.indexOf('--input') + 1];
if (!reportPath) throw new Error('--input is required');
const outputJsonPath = process.argv[process.argv.indexOf('--output-json') + 1];
const outputMarkdownPath = process.argv[process.argv.indexOf('--output-markdown') + 1];

/*
 * 报告格式偏差（缺 front matter、缺一级标题、finding 漏证据……）不判 INVALID，但要让人看见：
 * 接在报告正文后面，随报告一起进 PR 评论与产物。
 */
function withFormatNotes(markdown, notes) {
  if (!notes || notes.length === 0) return markdown;
  return [markdown.trimEnd(), '', '## Report format deviations (recorded by CI)', '', ...notes.map((note) => `- ${note}`), ''].join('\n');
}

let result;
let exitCode = 0;
try {
  result = parseAuditReport(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  result = {
    result: 'INVALID',
    blockingFindings: 0,
    reviewFindings: 0,
    changedPlugins: [],
    findings: [],
    error: error.message,
  };
  exitCode = 1;
}
if (outputJsonPath) fs.writeFileSync(outputJsonPath, `${JSON.stringify(result, null, 2)}\n`);
if (outputMarkdownPath) {
  const raw = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '# Plugin Semantic Audit\n\n- Report was not produced.\n';
  fs.writeFileSync(outputMarkdownPath, withFormatNotes(result.markdown ?? raw, result.notes));
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.result === 'BLOCK' || result.result === 'INVALID') exitCode = 1;
process.exitCode = exitCode;
