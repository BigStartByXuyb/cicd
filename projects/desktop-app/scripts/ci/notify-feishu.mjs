import fs from 'node:fs';

import { readRecipientMap, sendFeishuText } from '../../../../shared/ci/feishu-send.mjs';

/*
 * 应用 CI 的飞书通知。输入 JSON 里是本次运行的结论与仓库信息（由 workflow 拼好）。
 * 用法：node notify-feishu.mjs --input <json> [--dry-run]
 * 没有配置飞书密钥时打印跳过说明并以 0 退出（缺通知不是 CI 失败）。
 */

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const inputPath = arg('--input');
if (!inputPath) throw new Error('--input is required');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const status = ['PASS', 'REVIEW', 'BLOCK', 'INVALID'].includes(input.finalDecision) ? input.finalDecision : 'FAILED';
const markdown = [
  `【应用 CI/CD｜${status}】${input.repository}`,
  '',
  `提交：${String(input.commitSha ?? '').slice(0, 12) || '未知'}`,
  `触发：${input.trigger ?? '未知'}${input.pullRequestNumber ? `（PR #${input.pullRequestNumber} ${input.pullRequestTitle ?? ''}）` : ''}`,
  '',
  `最终结论：${status}`,
  `确定性检查：${input.deterministicResult === 'success' ? 'PASS' : 'FAILED'}`,
  `语义审计：${input.auditResult ?? '未完成'}（阻断 ${input.blockingFindings ?? 0} / 复核 ${input.reviewFindings ?? 0}）`,
  `运行时测试：${input.runtimeResult === 'success' ? 'PASS' : input.runtimeResult ?? '未运行'}`,
  '',
  `报告：${input.reportUrl ?? ''}`
].join('\n');

if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify({ status, markdown }, null, 2)}\n`);
  process.exit(0);
}

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const chatId = process.env.FEISHU_DEFAULT_CHAT_ID;
if (!appId || !appSecret || !chatId) {
  process.stdout.write(JSON.stringify({ skipped: true, reason: '未配置飞书密钥（FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_DEFAULT_CHAT_ID）' }) + '\n');
  process.exit(0);
}

const result = await sendFeishuText({
  appId,
  appSecret,
  chatId,
  recipientMap: readRecipientMap(process.env.FEISHU_RECIPIENT_MAP_JSON),
  authorLogin: input.authorLogin,
  reviewerLogins: input.reviewerLogins ?? [],
  markdown
});
process.stdout.write(`${JSON.stringify({ status, delivered: result.delivered })}\n`);
