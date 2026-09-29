import { resolveFeishuRecipients } from '../../projects/plugin-marketplace/scripts/ci/lib/feishu-notification.mjs';

/*
 * 飞书文本消息发送（所有套件共用一份实现）。
 * 只负责「拿 token → 解析收件人 → 逐条发送」，消息文案由调用方按自己的口径拼好传进来。
 */
export async function sendFeishuText({ appId, appSecret, chatId, recipientMap = {}, authorLogin, reviewerLogins = [], markdown }) {
  if (!appId || !appSecret || !chatId) throw new Error('FEISHU_APP_ID, FEISHU_APP_SECRET, and FEISHU_DEFAULT_CHAT_ID are required');
  if (!markdown) throw new Error('markdown is required');

  const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!tokenResponse.ok) throw new Error(`Feishu token request failed: ${tokenResponse.status}`);
  const { tenant_access_token: token } = await tokenResponse.json();

  const recipients = resolveFeishuRecipients({ authorLogin, reviewerLogins, recipientMap, defaultChatId: chatId });
  if (recipients.length === 0) throw new Error('no Feishu recipients resolved');
  for (const recipient of recipients) {
    const messageResponse = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${recipient.receiveIdType}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ receive_id: recipient.receiveId, msg_type: 'text', content: JSON.stringify({ text: markdown }) }),
    });
    if (!messageResponse.ok) throw new Error(`Feishu message request failed: ${messageResponse.status}`);
  }
  return { delivered: recipients.length };
}

// 环境变量里读收件人映射表：坏 JSON 只警告，不阻塞通知（退回默认群）。
export function readRecipientMap(rawValue) {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('recipient map must be a JSON object');
    return parsed;
  } catch {
    console.warn('FEISHU_RECIPIENT_MAP_JSON is invalid JSON; using the default chat only');
    return {};
  }
}
