import fs from 'node:fs';
import path from 'node:path';
import { readReportJobUrl } from '../../../../shared/ci/gitlab-pipeline.mjs';

// 从流水线环境与报告产物拼出飞书通知的输入。
// GitHub 侧由 workflow 用事件 JSON 拼同一形状；两处字段口径必须一致（消费方见 notify-feishu.mjs）。
// 用法：node build-notify-input.mjs --findings-dir <dir> --output <json>

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const findingsDir = arg('--findings-dir');
const outputPath = arg('--output');
if (!findingsDir || !outputPath) throw new Error('--findings-dir and --output are required');

function readJson(name) {
  const file = path.join(findingsDir, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// MR 的作者、标题、审阅者只有接口能给：取不到就退回流水线变量，不影响通知发出。
async function readMergeRequest({ apiBase, projectId, iid, token }) {
  if (!apiBase || !projectId || !iid || !token) return null;
  try {
    const response = await fetch(`${apiBase}/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const deterministic = readJson('deterministic-report.json');
const semantic = readJson('semantic-report.json');
const final = readJson('final-report.json');
const mergeRequest = await readMergeRequest({
  apiBase: process.env.CI_API_V4_URL,
  projectId: process.env.CALLER_PROJECT_ID,
  iid: process.env.CALLER_MR_IID,
  token: process.env.GITLAB_API_TOKEN,
});

const auditResult = semantic?.result ?? null;
const ranRuntimeTests = fs.existsSync(path.join(findingsDir, 'coverage.txt')) || fs.existsSync(path.join(findingsDir, 'ui-coverage.txt'));
const input = {
  repository: process.env.CALLER_PROJECT_PATH ?? '',
  trigger: `${process.env.CALLER_PIPELINE_SOURCE ?? 'unknown'} ${process.env.CALLER_REF_NAME ?? ''}`.trim(),
  pullRequestNumber: Number(process.env.CALLER_MR_IID ?? 0),
  pullRequestTitle: mergeRequest?.title ?? process.env.CALLER_MR_TITLE ?? '',
  commitSha: process.env.CALLER_COMMIT_SHA ?? '',
  authorLogin: mergeRequest?.author?.username ?? process.env.CALLER_USER_LOGIN ?? 'unknown',
  reviewerLogins: (mergeRequest?.reviewers ?? []).map((user) => user.username).filter(Boolean),
  runtimeResult: ranRuntimeTests ? 'success' : 'failure',
  deterministicResult: deterministic?.status === 'PASS' ? 'success' : 'failure',
  semanticResult: auditResult ? 'success' : 'failure',
  auditResult,
  finalDecision: final?.decision ?? 'UNKNOWN',
  blockingFindings: Number(final?.checks?.semantic?.blockingFindings ?? 0),
  reviewFindings: Number(final?.checks?.semantic?.reviewFindings ?? 0),
  findings: semantic?.findings ?? [],
  reportUrl: mergeRequest?.web_url ?? await readReportJobUrl() ?? process.env.CALLER_PIPELINE_URL ?? '',
};

fs.writeFileSync(outputPath, `${JSON.stringify(input)}\n`);
