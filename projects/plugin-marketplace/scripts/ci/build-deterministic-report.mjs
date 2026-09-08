import fs from 'node:fs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const inputPath = arg('--input');
const outputJsonPath = arg('--output-json');
const outputMarkdownPath = arg('--output-markdown');
const changedPlugins = JSON.parse(arg('--plugins-json', '[]'));
if (!inputPath || !outputJsonPath || !outputMarkdownPath) throw new Error('--input, --output-json, and --output-markdown are required');

const validation = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const report = {
  schemaVersion: 1,
  kind: 'deterministic-validation',
  status: validation.valid ? 'PASS' : 'BLOCK',
  decision: validation.valid ? 'PASS' : 'BLOCK',
  changedPlugins,
  errors: validation.errors ?? [],
  plugins: validation.plugins ?? [],
};
const markdown = [
  '# Deterministic Validation',
  '',
  `- Result: **${report.status}**`,
  `- Changed plugins: ${changedPlugins.join(', ') || 'none'}`,
  `- Errors: ${report.errors.length}`,
  '',
  '## Findings',
  '',
  ...(report.errors.length ? report.errors.map((error) => `- ${JSON.stringify(error)}`) : ['- None']),
  '',
].join('\n');

fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(outputMarkdownPath, markdown);
