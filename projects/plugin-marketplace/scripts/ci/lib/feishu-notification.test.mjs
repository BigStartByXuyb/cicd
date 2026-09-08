import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeishuNotification, resolveFeishuRecipients } from './feishu-notification.mjs';

test('builds a PASS notification for the author and default chat', () => {
  const message = buildFeishuNotification({
    repository: 'BigStartByXuyb/Plugins',
    pullRequestNumber: 42,
    pullRequestTitle: 'Add example plugin',
    commitSha: 'abcdef123456',
    authorLogin: 'alice',
    reviewerLogins: ['bob'],
    changedPlugins: ['example-plugin'],
    deterministicResult: 'success',
    semanticResult: 'success',
    auditResult: 'PASS',
    blockingFindings: 0,
    reviewFindings: 0,
    reportUrl: 'https://github.com/BigStartByXuyb/Plugins/actions/runs/1',
  });

  assert.equal(message.status, 'PASS');
  assert.deepEqual(message.recipients, { authorLogin: 'alice', useDefaultChat: true });
  assert.match(message.markdown, /Plugin CI\/CD｜PASS/);
  assert.match(message.markdown, /#42/);
  assert.match(message.markdown, /请审阅当前分析结果/);
  assert.match(message.markdown, /审阅者：bob/);
});

test('builds a BLOCK notification when semantic audit fails', () => {
  const message = buildFeishuNotification({
    repository: 'BigStartByXuyb/Plugins',
    pullRequestNumber: 43,
    pullRequestTitle: 'Conflicting plugin rules',
    commitSha: '1234567890ab',
    authorLogin: 'bob',
    changedPlugins: ['conflicting-plugin'],
    deterministicResult: 'success',
    semanticResult: 'failure',
    auditResult: 'BLOCK',
    blockingFindings: 1,
    reviewFindings: 0,
    reportUrl: 'https://github.com/BigStartByXuyb/Plugins/actions/runs/2',
  });

  assert.equal(message.status, 'BLOCK');
  assert.match(message.markdown, /阻断问题：1/);
});

test('uses the aggregated final decision and finding counts', () => {
  const message = buildFeishuNotification({
    repository: 'BigStartByXuyb/Plugins',
    pullRequestNumber: 46,
    pullRequestTitle: 'Reviewable plugin update',
    commitSha: '1234567890ab',
    authorLogin: 'alice',
    changedPlugins: ['example-plugin'],
    deterministicResult: 'success',
    semanticResult: 'success',
    auditResult: 'REVIEW',
    finalDecision: 'REVIEW',
    blockingFindings: 0,
    reviewFindings: 2,
    reportUrl: 'https://github.com/BigStartByXuyb/Plugins/actions/runs/4',
  });

  assert.equal(message.status, 'REVIEW');
  assert.match(message.markdown, /最终结论：REVIEW/);
  assert.match(message.markdown, /普通建议：2/);
});

test('reports failed validation and does not pretend Claude ran', () => {
  const message = buildFeishuNotification({
    repository: 'BigStartByXuyb/Plugins',
    pullRequestNumber: 44,
    pullRequestTitle: 'Broken manifest',
    commitSha: 'fedcba654321',
    authorLogin: 'carol',
    changedPlugins: ['broken-plugin'],
    deterministicResult: 'failure',
    semanticResult: 'skipped',
    auditResult: null,
    blockingFindings: 0,
    reviewFindings: 0,
    reportUrl: 'https://github.com/BigStartByXuyb/Plugins/actions/runs/3',
  });

  assert.equal(message.status, 'FAILED_BEFORE_AUDIT');
  assert.match(message.markdown, /Claude 语义审计：未运行/);
});

test('routes to the mapped author and always includes the maintenance chat', () => {
  assert.deepEqual(resolveFeishuRecipients({
    authorLogin: 'alice',
    reviewerLogins: ['bob', 'carol'],
    recipientMap: { alice: 'ou_author' },
    defaultChatId: 'oc_maintainers',
  }), [
    { receiveIdType: 'open_id', receiveId: 'ou_author' },
    { receiveIdType: 'chat_id', receiveId: 'oc_maintainers' },
  ]);
});

test('routes review-requested users to their mapped Feishu identities', () => {
  assert.deepEqual(resolveFeishuRecipients({
    authorLogin: 'alice',
    reviewerLogins: ['bob', 'carol', 'bob'],
    recipientMap: { alice: 'ou_author', bob: 'ou_reviewer' },
    defaultChatId: 'oc_maintainers',
  }), [
    { receiveIdType: 'open_id', receiveId: 'ou_author' },
    { receiveIdType: 'open_id', receiveId: 'ou_reviewer' },
    { receiveIdType: 'chat_id', receiveId: 'oc_maintainers' },
  ]);
});

test('marks unmapped reviewers while retaining the default chat fallback', () => {
  const message = buildFeishuNotification({
    repository: 'BigStartByXuyb/Plugins',
    pullRequestNumber: 45,
    pullRequestTitle: 'Needs review',
    commitSha: 'abcdef123456',
    authorLogin: 'alice',
    reviewerLogins: ['bob'],
    unresolvedReviewerLogins: ['bob'],
    changedPlugins: ['example-plugin'],
    deterministicResult: 'success',
    semanticResult: 'success',
    auditResult: 'PASS',
    blockingFindings: 0,
    reviewFindings: 0,
    reportUrl: 'https://github.com/BigStartByXuyb/Plugins/pull/45',
  });

  assert.match(message.markdown, /收件人映射缺失：bob/);
});
