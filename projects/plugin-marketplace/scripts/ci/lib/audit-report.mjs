const RESULTS = new Set(['PASS', 'REVIEW', 'BLOCK', 'INVALID']);
const SEVERITIES = new Set(['BLOCK', 'REVIEW']);
const AUDIT_VERSIONS = new Set(['1', '2']);
const HAN_PATTERN = /\p{Script=Han}/u;

// 报告全文：只去 BOM、首尾空白与「最外层代码围栏」，**不切掉 front matter 之前的标题/注释**
// （模型常把 `# 插件语义审计` 与 `<!-- contract_sha256 ... -->` 写在最前面）。
function normalizeAuditDocument(markdown) {
  const source = String(markdown ?? '').replace(/^\uFEFF/, '').trim();
  if (!source.startsWith('```')) return source;
  const withoutOpen = source.replace(/^```(?:markdown|md)?\s*\r?\n/i, '');
  return withoutOpen.replace(/\r?\n```\s*$/, '').trim();
}

// 落盘/输出用的规范化正文：从 front matter 起截断，保持历史产物形态。
export function normalizeAuditMarkdown(markdown) {
  const source = normalizeAuditDocument(markdown);
  const start = source.indexOf('---');
  if (start < 0) return source;
  return source.slice(start).trim();
}

function parseFrontMatterBody(lines) {
  const values = {};
  let listKey = null;
  for (const line of lines) {
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && listKey) {
      values[listKey] ??= [];
      values[listKey].push(listItem[1].trim());
      continue;
    }
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!field) continue;
    const [, key, rawValue] = field;
    if (rawValue === '') {
      listKey = key;
      values[key] = [];
    } else {
      listKey = null;
      values[key] = rawValue.trim();
    }
  }
  return values;
}

// front matter 允许出现在文档开头，也允许前面先有标题 / contract 注释。
// 这里按行扫描 `---` 之间的块，取**第一个含 `result:` 的块**——
// 既不因 front matter 不在第一行而判缺失，也不会把正文里的 `---` 分隔线误当 front matter。
function parseFrontMatter(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  for (let start = 0; start < lines.length; start += 1) {
    if (lines[start].trim() !== '---') continue;
    for (let end = start + 1; end < lines.length; end += 1) {
      if (lines[end].trim() !== '---') continue;
      const values = parseFrontMatterBody(lines.slice(start + 1, end));
      if (typeof values.result === 'string') return values;
      break;
    }
  }
  throw new Error('audit report is missing front matter');
}

function parseInteger(value, field) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${field} must be an integer`);
  return Number(value);
}

export function parseAuditReport(markdown) {
  // documentText：全文（保留 front matter 之前的标题/注释），用于 front matter 定位与各小节检查；
  // normalizedMarkdown：从 front matter 起的正文，保持历史产物形态。
  const documentText = normalizeAuditDocument(markdown);
  const normalizedMarkdown = normalizeAuditMarkdown(markdown);
  const frontMatter = parseFrontMatter(documentText);
  const result = frontMatter.result;
  if (!RESULTS.has(result)) throw new Error('result must be PASS, REVIEW, BLOCK, or INVALID');
  const auditVersion = String(frontMatter.audit_version);
  if (!AUDIT_VERSIONS.has(auditVersion)) throw new Error('unsupported audit_version');
  const requiredSections = auditVersion === '2'
    ? ['# 插件语义审计', '## 摘要', '## 问题', '## 非阻断观察', '## 审计限制']
    : ['# Plugin Semantic Audit', '## Summary', '## Findings', '## Non-blocking observations', '## Audit limitations'];

  const blockingFindings = parseInteger(frontMatter.blocking_findings, 'blocking_findings');
  const reviewFindings = parseInteger(frontMatter.review_findings, 'review_findings');
  const changedPlugins = Array.isArray(frontMatter.changed_plugins) ? frontMatter.changed_plugins : [];
  for (const section of requiredSections) {
    if (!documentText.includes(section)) throw new Error(`audit report is missing ${section}`);
  }
  if (auditVersion === '2') {
    const summaryStart = documentText.indexOf('## 摘要');
    const findingsStart = documentText.indexOf('## 问题');
    const summary = documentText.slice(summaryStart, findingsStart);
    if (!HAN_PATTERN.test(summary)) throw new Error('version 2 summary must contain Simplified Chinese prose');
  }

  const findings = [];
  const headings = [...documentText.matchAll(/^### \[((?:BLOCK|REVIEW)-\d+)\] (.+)$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].index;
    const end = headings[index + 1]?.index ?? documentText.length;
    const block = documentText.slice(start, end);
    const id = headings[index][1];
    const title = headings[index][2].trim();
    const severity = block.match(/^- (?:Severity|严重级别): `([^`]+)`$/m)?.[1];
    const category = block.match(/^- (?:Category|类别): `([^`]+)`$/m)?.[1] ?? null;
    const confidence = block.match(/^- (?:Confidence|置信度): `([^`]+)`$/m)?.[1];
    const scope = block.match(/^- (?:Scope|范围): `([^`]+)`$/m)?.[1] ?? null;
    const evidence = [...block.matchAll(/`([^`\r\n]+:\d+)`/g)].map((match) => match[1]);
    if (!SEVERITIES.has(severity)) throw new Error('finding severity is invalid');
    if (!confidence) throw new Error('finding confidence is missing');
    if (severity === 'BLOCK' && confidence !== 'high') {
      throw new Error('BLOCK finding must have high confidence');
    }
    if (evidence.length === 0) throw new Error('finding must contain evidence');
    if (auditVersion === '2' && !HAN_PATTERN.test(block)) {
      throw new Error('version 2 finding must contain Simplified Chinese prose');
    }
    findings.push({ id, title, severity, category, confidence, scope, evidence });
  }

  const actualBlocking = findings.filter((finding) => finding.severity === 'BLOCK').length;
  const actualReview = findings.filter((finding) => finding.severity === 'REVIEW').length;
  if (actualBlocking !== blockingFindings || actualReview !== reviewFindings) {
    throw new Error('finding counts do not match front matter');
  }
  if (result === 'BLOCK' && blockingFindings === 0) throw new Error('BLOCK result requires blocking findings');

  return { result, blockingFindings, reviewFindings, changedPlugins, findings, markdown: normalizedMarkdown };
}
