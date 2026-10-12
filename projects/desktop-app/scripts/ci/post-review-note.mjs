import fs from 'node:fs';

import { REVIEW_MARKERS, resolveReviewTarget, upsertReviewNote } from '../../../../shared/ci/review-note.mjs';

// 把最终报告贴到 PR/MR 上（有则更新）。用法：node post-review-note.mjs --input <json> [--dry-run]

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
  marker: REVIEW_MARKERS.desktopApp,
  markdown: input.markdown
});
process.stdout.write(`${JSON.stringify(result)}\n`);
