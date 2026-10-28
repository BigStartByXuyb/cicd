import fs from 'node:fs';

import { resolveReviewTarget, upsertReviewNote } from '../../../../shared/ci/review-note.mjs';

// 把最终报告贴到 MR 上（有则更新）。marker 由本套件自己定义，各套件各管自己那条评论。
// 用法：node post-review-note.mjs --input <json> [--dry-run]

const REVIEW_MARKER = 'bigstart-go-service-ci-report';

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

const result = await upsertReviewNote({
  ...resolveReviewTarget(),
  marker: REVIEW_MARKER,
  markdown: input.markdown
});
process.stdout.write(`${JSON.stringify(result)}\n`);
