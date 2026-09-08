import fs from 'node:fs';
import { buildFeishuNotification, resolveFeishuRecipients } from './lib/feishu-notification.mjs';

const inputPath = process.argv[process.argv.indexOf('--input') + 1];
if (!inputPath) throw new Error('--input is required');

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
let recipientMap = {};
if (process.env.FEISHU_RECIPIENT_MAP_JSON) recipientMap = JSON.parse(process.env.FEISHU_RECIPIENT_MAP_JSON);
const unresolvedReviewerLogins = (input.reviewerLogins ?? []).filter((login) => !recipientMap[login]);
const notification = buildFeishuNotification({ ...input, unresolvedReviewerLogins });
if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify(notification, null, 2)}\n`);
  process.exit(0);
}

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const chatId = process.env.FEISHU_DEFAULT_CHAT_ID;
if (!appId || !appSecret || !chatId) throw new Error('FEISHU_APP_ID, FEISHU_APP_SECRET, and FEISHU_DEFAULT_CHAT_ID are required');

const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
});
if (!tokenResponse.ok) throw new Error(`Feishu token request failed: ${tokenResponse.status}`);
const { tenant_access_token: token } = await tokenResponse.json();
const recipients = resolveFeishuRecipients({ authorLogin: input.authorLogin, reviewerLogins: input.reviewerLogins, recipientMap, defaultChatId: chatId });
if (recipients.length === 0) throw new Error('no Feishu recipients resolved');
for (const recipient of recipients) {
  const messageResponse = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${recipient.receiveIdType}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ receive_id: recipient.receiveId, msg_type: 'text', content: JSON.stringify({ text: notification.markdown }) }),
  });
  if (!messageResponse.ok) throw new Error(`Feishu message request failed: ${messageResponse.status}`);
}
process.stdout.write(`${JSON.stringify({ status: notification.status, delivered: recipients.length })}\n`);
