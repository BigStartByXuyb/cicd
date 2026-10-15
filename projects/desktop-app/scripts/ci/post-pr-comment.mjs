import fs from 'node:fs';

import { upsertPrComment } from '../../../../shared/ci/github-pr-comment.mjs';

// 把最终报告贴到 PR 上（有则更新）。用法：node post-pr-comment.mjs --input <json> [--dry-run]

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const inputPath = arg('--input');
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
  marker: 'bigstart-app-ci-report',
  markdown: input.markdown
});
process.stdout.write(`${JSON.stringify(result)}\n`);
