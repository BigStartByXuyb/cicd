import { formatFailedJobs, formatReviewFindings } from '../../../../../shared/ci/audit-summary.mjs';

function shortSha(value) {
  return String(value).slice(0, 12);
}

function statusFor(input) {
  if ([input.deterministicResult, input.semanticResult].includes('cancelled')) return 'CANCELLED';
  if (['PASS', 'REVIEW', 'BLOCK', 'INVALID', 'FAILED'].includes(input.finalDecision)) return input.finalDecision;
  if (input.finalDecision === 'UNKNOWN') return 'FAILED';
  if (input.deterministicResult !== 'success') return 'FAILED_BEFORE_AUDIT';
  if (input.auditResult === 'BLOCK') return 'BLOCK';
  if (input.auditResult === 'INVALID' || input.semanticResult === 'failure') return 'INVALID';
  if (input.auditResult === 'REVIEW') return 'REVIEW';
  return 'PASS';
}

export function buildFeishuNotification(input) {
  const status = statusFor(input);
  const semanticLine = input.deterministicResult === 'success'
    ? `Claude 语义审计：${input.auditResult ?? '未完成'}`
    : 'Claude 语义审计：未运行';
  const markdown = [
    `【Plugin CI/CD｜${status}】${input.repository}`,
    '',
    `项目：${input.repository}`,
    `PR：#${input.pullRequestNumber} ${input.pullRequestTitle}`,
    `提交：${shortSha(input.commitSha)}`,
    `提交者：${input.authorLogin}`,
    `插件：${input.changedPlugins.join(', ') || '无'}`,
    '',
    `最终结论：${status}`,
    `结构检查：${input.deterministicResult === 'success' ? 'PASS' : 'FAILED'}`,
    semanticLine,
    `阻断问题：${input.blockingFindings}`,
    `普通建议：${input.reviewFindings}`,
    ...formatReviewFindings(input.findings),
    ...(input.runtimeResult ? [`运行时测试：${input.runtimeResult === 'success' ? 'PASS' : 'FAILED'}`] : []),
    ...formatFailedJobs(input.failedJobs),
    '',
    `请审阅当前分析结果并在 PR 中反馈。审阅者：${input.reviewerLogins?.join(', ') || '未指定'}`,
    ...(input.unresolvedReviewerLogins?.length
      ? [`收件人映射缺失：${input.unresolvedReviewerLogins.join(', ')}；这些审阅者未收到私信。`]
      : []),
    `查看 CI 审计详情：${input.reportUrl}`,
  ].join('\n');

  return {
    status,
    recipients: { authorLogin: input.authorLogin, useDefaultChat: true },
    markdown,
  };
}

export function resolveFeishuRecipients({ authorLogin, reviewerLogins = [], recipientMap = {}, defaultChatId }) {
  const recipients = [];
  const logins = [authorLogin, ...reviewerLogins];
  const seen = new Set();
  for (const login of logins) {
    const openId = recipientMap[login];
    if (openId && !seen.has(openId)) {
      recipients.push({ receiveIdType: 'open_id', receiveId: openId });
      seen.add(openId);
    }
  }
  if (defaultChatId) recipients.push({ receiveIdType: 'chat_id', receiveId: defaultChatId });
  return recipients;
}
