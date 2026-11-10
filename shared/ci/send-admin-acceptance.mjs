import { readRecipientMap, sendFeishuText } from './feishu-send.mjs';
import { readFinalReport, readPipelineJobs } from './gitlab-pipeline.mjs';

const jobs = await readPipelineJobs();
const finalReport = await readFinalReport(jobs);
const checkStages = new Set(['source', 'validate', 'test', 'audit', 'report', 'notify']);
const checkJobs = jobs.filter((job) => checkStages.has(job.stage));
const allChecksPassed = checkJobs.length > 0 && checkJobs.every((job) => job.status === 'success');
if (finalReport?.report.decision !== 'PASS' || !allChecksPassed) {
  process.stdout.write(`${JSON.stringify({ acceptance: 'skipped', decision: finalReport?.report.decision ?? 'UNKNOWN', allChecksPassed })}\n`);
  process.exit(0);
}

const mergeRequestUrl = process.env.CALLER_MR_IID && process.env.CALLER_PROJECT_PATH
  ? `${process.env.CI_SERVER_URL}/${process.env.CALLER_PROJECT_PATH}/-/merge_requests/${process.env.CALLER_MR_IID}`
  : null;

const markdown = [
  `【MW CI/CD｜PASS｜待管理员验收】${process.env.CALLER_PROJECT_PATH ?? ''}`,
  '',
  `提交：${String(process.env.CALLER_COMMIT_SHA ?? '').slice(0, 12) || '未知'}`,
  `分支：${process.env.CALLER_REF_NAME ?? '未知'}`,
  ...(process.env.CALLER_MR_IID ? [`MR：!${process.env.CALLER_MR_IID} ${process.env.CALLER_MR_TITLE ?? ''}`] : []),
  ...(mergeRequestUrl ? [`MR 审计评论：${mergeRequestUrl}`] : []),
  '',
  '所有 CI job 和语义审计均为 PASS，请管理员完成验收。',
  `最终报告：${finalReport.job.web_url ?? ''}`,
  `源流水线：${process.env.CALLER_PIPELINE_URL ?? ''}`,
  `中央流水线：${process.env.CI_PIPELINE_URL ?? ''}`,
].join('\n');

const recipientMap = readRecipientMap(process.env.FEISHU_RECIPIENT_MAP_JSON);
const adminLogins = [...new Set((process.env.FEISHU_ADMIN_GITLAB_LOGINS ?? '')
  .split(',')
  .map((login) => login.trim())
  .filter(Boolean))];
const mappedAdminLogins = adminLogins.filter((login) => recipientMap[login]);
const unmappedAdminLogins = adminLogins.filter((login) => !recipientMap[login]);
const delivery = await sendFeishuText({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  recipientMap,
  reviewerLogins: mappedAdminLogins,
  markdown,
});

process.stdout.write(`${JSON.stringify({
  acceptance: 'requested',
  delivery: delivery.skipped ? 'skipped' : 'sent',
  delivered: delivery.delivered ?? 0,
  unmappedAdminLogins,
})}\n`);
