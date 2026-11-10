const TRACE_MATCH = /(?:\berror\b|\bfatal\b|\bfailed\b|\bnot ok\b|\bnot found\b|\bcommand not found\b|\bdenied\b|\btimed out\b|\bexit code\b|\bERR_[A-Z0-9_]+\b|\bENOENT\b|\bspawn(?:Sync|Async)\b|\bAssertionError\b|未通过|缺少|失败|退出码|找不到|无法|✖)/i;
const TRACE_NOISE = /(?:upload(?:ing)? artifacts|artifacts-uploader|section_(?:start|end)|cleaning up project directory|ERROR: Job failed: exit code)/i;

function gitlabRequestUrl(path) {
  const { CI_API_V4_URL, CI_PROJECT_ID, GITLAB_API_TOKEN } = process.env;
  if (!CI_API_V4_URL || !CI_PROJECT_ID || !GITLAB_API_TOKEN) {
    throw new Error('GitLab pipeline API configuration is required');
  }
  return {
    url: `${CI_API_V4_URL}/projects/${encodeURIComponent(CI_PROJECT_ID)}${path}`,
    headers: { 'PRIVATE-TOKEN': GITLAB_API_TOKEN },
  };
}

export async function readPipelineJobs() {
  const { CI_PIPELINE_ID } = process.env;
  if (!CI_PIPELINE_ID) throw new Error('CI_PIPELINE_ID is required');
  const request = gitlabRequestUrl(`/pipelines/${CI_PIPELINE_ID}/jobs?per_page=100`);
  const response = await fetch(request.url, { headers: request.headers });
  if (!response.ok) throw new Error(`GitLab pipeline jobs request failed: ${response.status}`);
  return response.json();
}

export async function readReportJobUrl() {
  if (!process.env.CI_API_V4_URL || !process.env.CI_PROJECT_ID || !process.env.CI_PIPELINE_ID || !process.env.GITLAB_API_TOKEN) {
    return null;
  }
  const jobs = await readPipelineJobs();
  const reportJob = jobs.find((job) => job.stage === 'report' && job.status === 'success');
  if (!reportJob) return process.env.CI_PIPELINE_URL ?? null;
  return reportJob.web_url ?? process.env.CI_PIPELINE_URL ?? null;
}

export async function readFinalReport(jobs) {
  const pipelineJobs = jobs ?? await readPipelineJobs();
  const reportJob = pipelineJobs.find((job) => job.stage === 'report' && job.status === 'success');
  if (!reportJob) return null;
  const request = gitlabRequestUrl(`/jobs/${reportJob.id}/artifacts/.ci-tmp/final-report.json`);
  const response = await fetch(request.url, { headers: request.headers });
  if (!response.ok) return null;
  return { report: await response.json(), job: reportJob };
}

function redact(text) {
  return text
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [REDACTED]')
    .replace(/\b(?:PRIVATE-TOKEN|CI_JOB_TOKEN|ANTHROPIC_API_KEY|FEISHU_APP_SECRET|Authorization)\b\s*[:=]\s*\S+/gi, '[REDACTED]')
    .replace(/([?&](?:job_token|private_token|access_token|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTED]')
    .trim();
}

export async function readJobFailureSummary(job) {
  if (!job.id) return '';
  const request = gitlabRequestUrl(`/jobs/${job.id}/trace`);
  const response = await fetch(request.url, { headers: request.headers });
  if (!response.ok) return `无法读取 job 日志（HTTP ${response.status}）`;

  const lines = redact(await response.text())
    .split(/\r?\n/)
    .map((line) => line.replace(/^\S+\s+\d{2}[OE]\s+/, '').trim())
    .filter((line) => line && TRACE_MATCH.test(line) && !TRACE_NOISE.test(line));
  const uniqueLines = [...new Set(lines)].slice(0, 3);
  const summary = uniqueLines.join('\n').slice(-420);
  return summary || '日志未提供可提取的错误摘要，请打开 job 查看完整日志。';
}
