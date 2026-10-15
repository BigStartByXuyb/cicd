import fs from 'node:fs';
import { upsertPrComment } from '../../../../shared/ci/github-pr-comment.mjs';

const inputPath = process.argv[process.argv.indexOf('--input') + 1];
if (!inputPath) throw new Error('--input is required');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify(input, null, 2)}\n`);
  process.exit(0);
}

const result = await upsertPrComment({
  token: process.env.GITHUB_TOKEN,
  repository: process.env.GITHUB_REPOSITORY,
  pullRequestNumber: process.env.PR_NUMBER,
  marker: 'bigstart-plugin-semantic-audit',
  markdown: input.markdown
});
process.stdout.write(`${JSON.stringify(result)}\n`);
