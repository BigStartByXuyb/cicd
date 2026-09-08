import fs from 'node:fs';

const inputPath = process.argv[process.argv.indexOf('--input') + 1];
if (!inputPath) throw new Error('--input is required');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify(input, null, 2)}\n`);
  process.exit(0);
}

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const pullRequestNumber = process.env.PR_NUMBER;
if (!token || !repository || !pullRequestNumber) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, and PR_NUMBER are required');

const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
const baseUrl = `https://api.github.com/repos/${repository}`;
const commentsResponse = await fetch(`${baseUrl}/issues/${pullRequestNumber}/comments?per_page=100`, { headers });
if (!commentsResponse.ok) throw new Error(`GitHub comments request failed: ${commentsResponse.status}`);
const comments = await commentsResponse.json();
const body = `<!-- bigstart-plugin-semantic-audit -->\n${input.markdown}\n<!-- /bigstart-plugin-semantic-audit -->`;
const existing = comments.find((comment) => comment.body?.includes('<!-- bigstart-plugin-semantic-audit -->'));
const response = existing
  ? await fetch(`${baseUrl}/issues/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
  : await fetch(`${baseUrl}/issues/${pullRequestNumber}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
if (!response.ok) throw new Error(`GitHub comment write failed: ${response.status}`);
process.stdout.write(`${JSON.stringify({ updated: Boolean(existing) })}\n`);
