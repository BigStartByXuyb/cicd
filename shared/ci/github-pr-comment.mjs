/*
 * 在调用方仓库的 PR 上「有则更新、无则新建」一条报告评论（所有套件共用一份实现）。
 * marker 是这条评论的身份标记：换套件换 marker，两套 CI 各管自己那条，不互相覆盖。
 */
export async function upsertPrComment({ token, repository, pullRequestNumber, marker, markdown }) {
  if (!token || !repository || !pullRequestNumber) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, and PR_NUMBER are required');
  if (!marker) throw new Error('marker is required');

  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  const baseUrl = `https://api.github.com/repos/${repository}`;
  const commentsResponse = await fetch(`${baseUrl}/issues/${pullRequestNumber}/comments?per_page=100`, { headers });
  if (!commentsResponse.ok) throw new Error(`GitHub comments request failed: ${commentsResponse.status}`);
  const comments = await commentsResponse.json();

  const open = `<!-- ${marker} -->`;
  const close = `<!-- /${marker} -->`;
  const body = `${open}\n${markdown}\n${close}`;
  const existing = comments.find((comment) => comment.body?.includes(open));
  const response = existing
    ? await fetch(`${baseUrl}/issues/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetch(`${baseUrl}/issues/${pullRequestNumber}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
  if (!response.ok) throw new Error(`GitHub comment write failed: ${response.status}`);
  return { updated: Boolean(existing) };
}
