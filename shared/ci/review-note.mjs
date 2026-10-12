/*
 * 在调用方仓库的 PR/MR 上「有则更新、无则新建」一条报告评论（所有套件共用一份实现）。
 * marker 是这条评论的身份标记：换套件换 marker，各套件各管自己那条，不互相覆盖。
 *
 * 两个提供方共用同一份 upsert 契约，只有传输层不同：
 * - github：GitHub Issues 评论接口，令牌与仓库来自 GITHUB_TOKEN / GITHUB_REPOSITORY，编号来自 PR_NUMBER。
 * - gitlab：GitLab Merge Request Notes 接口，令牌与项目来自 GITLAB_API_TOKEN / CI_PROJECT_ID /
 *   CI_API_V4_URL，编号来自 CI_MERGE_REQUEST_IID。
 */

export const REVIEW_MARKERS = {
  pluginMarketplace: 'bigstart-plugin-semantic-audit',
  desktopApp: 'bigstart-app-ci-report',
};

function wrapBody(marker, markdown) {
  return `<!-- ${marker} -->\n${markdown}\n<!-- /${marker} -->`;
}

async function upsertGitHubNote({ token, repository, number, marker, markdown }) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  const baseUrl = `https://api.github.com/repos/${repository}`;
  const commentsResponse = await fetch(`${baseUrl}/issues/${number}/comments?per_page=100`, { headers });
  if (!commentsResponse.ok) throw new Error(`GitHub comments request failed: ${commentsResponse.status}`);
  const comments = await commentsResponse.json();

  const open = `<!-- ${marker} -->`;
  const body = wrapBody(marker, markdown);
  const existing = comments.find((comment) => comment.body?.includes(open));
  const response = existing
    ? await fetch(`${baseUrl}/issues/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetch(`${baseUrl}/issues/${number}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
  if (!response.ok) throw new Error(`GitHub comment write failed: ${response.status}`);
  return { provider: 'github', updated: Boolean(existing) };
}

async function upsertGitLabNote({ token, apiBase, projectId, mergeRequestIid, marker, markdown }) {
  const headers = { 'PRIVATE-TOKEN': token, 'content-type': 'application/json' };
  const baseUrl = `${apiBase}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestIid}/notes`;
  const listResponse = await fetch(`${baseUrl}?per_page=100&sort=asc`, { headers });
  if (!listResponse.ok) throw new Error(`GitLab notes request failed: ${listResponse.status}`);
  const notes = await listResponse.json();

  const open = `<!-- ${marker} -->`;
  const body = wrapBody(marker, markdown);
  const existing = notes.find((note) => note.body?.includes(open));
  const response = existing
    ? await fetch(`${baseUrl}/${existing.id}`, { method: 'PUT', headers, body: JSON.stringify({ body }) })
    : await fetch(baseUrl, { method: 'POST', headers, body: JSON.stringify({ body }) });
  if (!response.ok) throw new Error(`GitLab note write failed: ${response.status}`);
  return { provider: 'gitlab', updated: Boolean(existing) };
}

export async function upsertReviewNote({ provider, marker, markdown, token, repository, number, apiBase, projectId, mergeRequestIid }) {
  if (!marker) throw new Error('marker is required');
  if (!token) throw new Error('token is required');
  if (provider === 'github') {
    if (!repository || !number) throw new Error('GITHUB_REPOSITORY and PR_NUMBER are required');
    return upsertGitHubNote({ token, repository, number, marker, markdown });
  }
  if (provider === 'gitlab') {
    if (!apiBase || !projectId || !mergeRequestIid) throw new Error('CI_API_V4_URL, CI_PROJECT_ID and CI_MERGE_REQUEST_IID are required');
    return upsertGitLabNote({ token, apiBase, projectId, mergeRequestIid, marker, markdown });
  }
  throw new Error(`unsupported provider: ${provider}`);
}

/*
 * 从环境里认这次跑在哪个提供方上：有 MR 编号就是 GitLab，否则按 GitHub 的 PR 编号走。
 * 两个提供方各自的令牌与仓库标识不在这里回退——缺哪个由 upsertReviewNote 报出来。
 */
export function resolveReviewTarget(env = process.env) {
  if (env.CI_MERGE_REQUEST_IID) {
    return { provider: 'gitlab', token: env.GITLAB_API_TOKEN, apiBase: env.CI_API_V4_URL, projectId: env.CI_PROJECT_ID, mergeRequestIid: env.CI_MERGE_REQUEST_IID };
  }
  return { provider: 'github', token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, number: env.PR_NUMBER };
}
