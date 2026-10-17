import { sendFeishuText } from './feishu-send.mjs';

const markdown = [
  `【MW CI/CD｜待管理员验收】${process.env.CALLER_PROJECT_PATH ?? ''}`,
  '',
  `提交：${String(process.env.CALLER_COMMIT_SHA ?? '').slice(0, 12) || '未知'}`,
  `分支：${process.env.CALLER_REF_NAME ?? '未知'}`,
  ...(process.env.CALLER_MR_IID ? [`MR：!${process.env.CALLER_MR_IID} ${process.env.CALLER_MR_TITLE ?? ''}`] : []),
  '',
  '所有 CI job 已通过，请管理员完成验收。',
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
