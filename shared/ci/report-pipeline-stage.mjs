import { readRecipientMap, sendFeishuText } from './feishu-send.mjs';
import { readJobFailureSummary, readPipelineJobs } from './gitlab-pipeline.mjs';

const stage = process.env.CI_STATUS_STAGE;
if (!stage) throw new Error('CI_STATUS_STAGE is required');

const STATUS_LABELS = {
  started: '已启动',
  success: '通过',
  failed: '失败',
  canceled: '已取消',
  skipped: '未运行',
  unknown: '状态未知',
};

async function stageResult(stageName, allJobs) {
  const jobs = allJobs.filter((job) => job.stage === stageName);
  if (jobs.length === 0 || jobs.every((job) => job.status === 'skipped')) {
    return { status: 'skipped', jobs };
  }
  if (jobs.some((job) => job.status === 'failed')) return { status: 'failed', jobs };
  if (jobs.some((job) => ['canceled', 'canceling'].includes(job.status))) return { status: 'canceled', jobs };
  if (jobs.every((job) => job.status === 'success' || job.status === 'skipped' || job.status === 'manual')) {
    return { status: 'success', jobs };
  }
  return { status: 'unknown', jobs };
}

const allJobs = stage === 'started' ? [] : await readPipelineJobs();
const result = stage === 'started'
  ? { status: 'started', jobs: [] }
  : await stageResult(stage, allJobs);
const { CALLER_CI_SUITE, CALLER_COMMIT_SHA, CALLER_MR_IID, CALLER_PROJECT_PATH, CALLER_REF_NAME, CALLER_USER_LOGIN } = process.env;
const recipientMap = readRecipientMap(process.env.FEISHU_RECIPIENT_MAP_JSON);
const authorMapped = Boolean(recipientMap[CALLER_USER_LOGIN]);
const defaultChatId = authorMapped ? undefined : process.env.FEISHU_DEFAULT_CHAT_ID;
const jobSummary = (await Promise.all(result.jobs.map(async (job) => {
  if (job.status !== 'failed') return `${job.name}: ${job.status}`;
  const detail = await readJobFailureSummary(job);
  return `${job.name}: 失败\n${job.web_url ?? ''}\n${detail}`;
}))).join('\n');
const markdown = [
  `【MW CI/CD｜${STATUS_LABELS[result.status] ?? STATUS_LABELS.unknown}】${CALLER_PROJECT_PATH ?? ''}`,
  `套件：${CALLER_CI_SUITE ?? 'unknown'}`,
  `提交：${String(CALLER_COMMIT_SHA ?? '').slice(0, 12) || '未知'}`,
  `分支：${CALLER_REF_NAME ?? '未知'}`,
  ...(CALLER_MR_IID ? [`MR：!${CALLER_MR_IID}`] : []),
  ...(jobSummary ? ['', jobSummary] : []),
  ...(authorMapped ? [] : ['', `提交者 ${CALLER_USER_LOGIN ?? 'unknown'} 尚未配置 Feishu open_id；本次状态发送到默认维护群。`]),
  `中央流水线：${process.env.CI_PIPELINE_URL ?? ''}`,
  `调用仓库流水线：${process.env.CALLER_PIPELINE_URL ?? ''}`,
].join('\n');

const delivery = await sendFeishuText({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  chatId: defaultChatId,
  recipientMap,
  authorLogin: CALLER_USER_LOGIN,
  markdown,
});

process.stdout.write(`${JSON.stringify({ stage, status: result.status, delivery: delivery.skipped ? 'skipped' : 'sent' })}\n`);
