import fs from 'node:fs';
import { buildFeishuNotification } from './lib/feishu-notification.mjs';
import { readRecipientMap, sendFeishuText } from '../../../../shared/ci/feishu-send.mjs';

const inputPath = process.argv[process.argv.indexOf('--input') + 1];
if (!inputPath) throw new Error('--input is required');

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const recipientMap = readRecipientMap(process.env.FEISHU_RECIPIENT_MAP_JSON);
const unresolvedReviewerLogins = (input.reviewerLogins ?? []).filter((login) => !recipientMap[login]);
const notification = buildFeishuNotification({ ...input, unresolvedReviewerLogins });
if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify(notification, null, 2)}\n`);
  process.exit(0);
}

const delivered = await sendFeishuText({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  chatId: process.env.FEISHU_DEFAULT_CHAT_ID,
  recipientMap,
  authorLogin: input.authorLogin,
  reviewerLogins: input.reviewerLogins,
  markdown: notification.markdown
});
process.stdout.write(`${JSON.stringify({ status: notification.status, delivered: delivered.delivered })}\n`);
