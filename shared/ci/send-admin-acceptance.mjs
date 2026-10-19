import { sendFeishuText } from './feishu-send.mjs';
import { readAuditDecision, readPipelineJobs } from './gitlab-pipeline.mjs';

const jobs = await readPipelineJobs();
const audit = await readAuditDecision(jobs);
const auditLines = audit
  ? [
      `语义审计：${audit.decision}${audit.decision === 'REVIEW' ? `，待复核 ${audit.reviewFindings} 项` : ''}`,
      ...(audit.findingTitles ?? []).map((title) => `- ${title}`),
      `审计 job：${audit.job.web_url ?? ''}`,
      ...(audit.reportJob ? [`审计报告：${audit.reportJob.web_url ?? ''}`] : []),
    ]
  : ['语义审计：请在中央流水线中查看审计 job。'];

const markdown = [
  `【MW CI/CD｜待管理员验收】${process.env.CALLER_PROJECT_PATH ?? ''}`,
  '',
  `提交：${String(process.env.CALLER_COMMIT_SHA ?? '').slice(0, 12) || '未知'}`,
  `分支：${process.env.CALLER_REF_NAME ?? '未知'}`,
  ...(process.env.CALLER_MR_IID ? [`MR：!${process.env.CALLER_MR_IID} ${process.env.CALLER_MR_TITLE ?? ''}`] : []),
  '',
  '所有 CI job 已通过，请管理员完成验收。',
  ...auditLines,
  `源流水线：${process.env.CALLER_PIPELINE_URL ?? ''}`,
  `中央流水线：${process.env.CI_PIPELINE_URL ?? ''}`,
].join('\n');

const delivery = await sendFeishuText({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  chatId: process.env.FEISHU_DEFAULT_CHAT_ID,
  markdown,
});

process.stdout.write(`${JSON.stringify({ acceptance: 'requested', delivery: delivery.skipped ? 'skipped' : 'sent' })}\n`);
