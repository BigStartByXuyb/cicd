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
const decision = deterministicStatus !== 'PASS'
  ? 'BLOCK'
  : semanticResult === 'BLOCK' || semanticResult === 'INVALID'
    ? 'BLOCK'
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
  ? report.findings.map((finding) => `- **${finding.id ?? finding.severity}** ${finding.title ?? ''} (${finding.scope ?? 'unknown scope'})`).join('\n')
  : '- None';
const markdown = [
  '# Plugin CI/CD Report',
  '',
  `- Decision: **${report.decision}**`,
  `- Changed plugins: ${changedPlugins.join(', ') || 'none'}`,
  '',
  '## Checks',
  '',
  `- Deterministic validation: **${deterministicStatus}**`,
  `- Semantic audit: **${semanticResult}**`,
  `- Blocking findings: **${report.checks.semantic.blockingFindings}**`,
  `- Review findings: **${report.checks.semantic.reviewFindings}**`,
  '',
  '## Findings',
  '',
  findingLines,
  '',
  semanticMarkdown,
  '',
].join('\n');

fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(outputMarkdownPath, markdown);
