const RESULTS = new Set(['PASS', 'REVIEW', 'BLOCK', 'INVALID']);
const SEVERITIES = new Set(['BLOCK', 'REVIEW']);
const AUDIT_VERSIONS = new Set(['1', '2']);
/* 各套件报告的一级标题：写了**别的套件**的标题说明模型套错了契约 —— 那要拒，不能只记备注。 */
const SUITE_TITLES = ['# 插件语义审计', '# 应用语义审计', '# Plugin Semantic Audit'];
const HAN_PATTERN = /\p{Script=Han}/u;
/*
 * 证据 = 反引号里带行号的引用。接受的写法：
 *   `lib/a.js:12`、`lib/a.js:12-15`（区间）、`lib/a.js:12,15`（几处）、`C:\路径\a.js:12`。
 * 网址不算证据 —— `https://host:8443/x` 是地址不是代码位置，所以排掉 http(s):// 开头的那一类。
 */
const EVIDENCE_PATTERN = /`((?!https?:\/\/)[^`\r\n]+:\d+(?:[-–~]\s*\d+)*(?:\s*,\s*\d+)*)`/g;

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
  // 没有 front matter 不再整份判 INVALID：报告的真值是它写了哪些 finding，front matter 只是那份摘要 ——
  // 缺了就按 findings 反推（见 parseAuditReport），并在备注里说明，人能看到这处偏差。
  return null;
}

function parseInteger(value, field) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${field} must be an integer`);
  return Number(value);
}

// title 是报告一级标题：默认插件套件的口径，其它套件（例如应用）传自己的标题，
// 报告契约（front matter、finding 形状、章节顺序）保持同一份。
export function parseAuditReport(markdown, { title = '# 插件语义审计' } = {}) {
  // documentText：全文（保留 front matter 之前的标题/注释），用于 front matter 定位与各小节检查；
  // normalizedMarkdown：从 front matter 起的正文，保持历史产物形态。
  const documentText = normalizeAuditDocument(markdown);
  const normalizedMarkdown = normalizeAuditMarkdown(markdown);
  const frontMatter = parseFrontMatter(documentText);
  const notes = [];
  if (!frontMatter) notes.push('报告缺 front matter：result 与条数按 findings 反推');
  // 没有 front matter 时按正文认版本：v2 的报告正文用中文小节名，v1（插件套件）用英文。
  const hasV2Body = /^## (摘要|问题)/m.test(documentText);
  const statedVersion = frontMatter?.audit_version === undefined ? null : String(frontMatter.audit_version);
  // 版本号写错/写了个没见过的值（模型偶尔写成 3 或 "v2"）不判整份 INVALID：按正文认版本，记一条备注。
  const auditVersion = statedVersion !== null && AUDIT_VERSIONS.has(statedVersion) ? statedVersion : hasV2Body ? '2' : '1';
  if (statedVersion !== null && statedVersion !== auditVersion) {
    notes.push(`front matter 的 audit_version=${statedVersion} 不是已知版本：按正文认作 v${auditVersion}`);
  }
  const suiteTitle = auditVersion === '2' ? title : '# Plugin Semantic Audit';
  const requiredSections = auditVersion === '2'
    ? ['## 摘要', '## 问题', '## 非阻断观察', '## 审计限制']
    : ['## Summary', '## Findings', '## Non-blocking observations', '## Audit limitations'];

  const changedPlugins = Array.isArray(frontMatter?.changed_plugins) ? frontMatter.changed_plugins : [];
  /*
   * 一级标题：漏写只是格式细节（小节已经把套件认出来了）——记一条备注；
   * 但写成别的套件的标题说明模型套错了契约，那要当场拒。
   */
  if (!documentText.includes(suiteTitle)) {
    const otherSuite = SUITE_TITLES.find((candidate) => candidate !== suiteTitle && documentText.includes(candidate));
    if (otherSuite) throw new Error(`audit report uses another suite's heading: ${otherSuite}`);
    notes.push(`报告缺一级标题 ${suiteTitle}（按报告正文采信）`);
  }
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
  // 标题是给人读的：`### [REVIEW-001]` 后面漏写标题仍是一条 finding ——
  // 判 INVALID 的是语义问题（枚举冲突 / 缺证据 / 计数不符……），不是标题写没写。
  const headings = [...documentText.matchAll(/^### \[((?:BLOCK|REVIEW)-\d+)\](.*)$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].index;
    const end = headings[index + 1]?.index ?? documentText.length;
    const block = documentText.slice(start, end);
    const id = headings[index][1];
    const title = headings[index][2].trim();
    // 字段值带不带反引号都接受：反引号只是渲染细节（模板里有，模型时写时不写），
    // 而「没写反引号」不改变报告含义。真正判 INVALID 的是语义问题（枚举冲突 / 缺证据 /
    // BLOCK 缺 high 置信度 / 计数不符 / 缺小节……），见下方各断言。
    const field = (labels) => (block.match(new RegExp(`^- (?:${labels.join('|')}):\\s*(.+?)\\s*$`, 'm'))?.[1] ?? '')
      .replace(/`/g, '')
      .trim();
    // finding ID 前缀是 kind 的权威来源：标题正则已把 ID 限定为 BLOCK-*/REVIEW-*。
    // `- Severity:` 只作人读字段——写成 human 等级词（high / medium / non-blocking）或漏反引号都不再让
    // 整份报告失效；但它与 ID 前缀**冲突**时仍然报错：那是报告自相矛盾，不能默默采信。
    const severityFromId = id.split('-')[0];
    const severityField = field(['Severity', '严重级别']);
    if (SEVERITIES.has(severityField) && severityField !== severityFromId) {
      throw new Error(`finding ${id} 的 Severity 字段（${severityField}）与 ID 前缀（${severityFromId}）不一致`);
    }
    const severity = SEVERITIES.has(severityField) ? severityField : severityFromId;
    const category = field(['Category', '类别']) || null;
    const confidence = field(['Confidence', '置信度']);
    const scope = field(['Scope', '范围']) || null;
    const evidence = [...block.matchAll(EVIDENCE_PATTERN)].map((match) => match[1]);
    if (!confidence) throw new Error('finding confidence is missing');
    if (severity === 'BLOCK' && confidence !== 'high') {
      throw new Error('BLOCK finding must have high confidence');
    }
    /*
     * 证据是复核的价值所在，但「漏写证据」是格式偏差、不是结论矛盾：
     * BLOCK 仍然必须给出可查的位置（没证据的阻断不能采信），REVIEW 照收并标出来，让人自己看缺哪一条。
     */
    if (evidence.length === 0) {
      if (severity === 'BLOCK') throw new Error('BLOCK finding must contain evidence');
      notes.push(`finding ${id} 没有给出代码位置（证据缺失）`);
    }
    if (auditVersion === '2' && !HAN_PATTERN.test(block)) {
      throw new Error('version 2 finding must contain Simplified Chinese prose');
    }
    findings.push({ id, title, severity, category, confidence, scope, evidence, evidenceMissing: evidence.length === 0 });
  }

  const actualBlocking = findings.filter((finding) => finding.severity === 'BLOCK').length;
  const actualReview = findings.filter((finding) => finding.severity === 'REVIEW').length;
  /*
   * 条数与结果以 findings 为准：front matter 与正文不一致时（模型常写错条数）只记一条备注并采信正文 ——
   * 采信摘要会把「写了 BLOCK 却声称 0 条」这种自相矛盾悄悄放过去。
   */
  const statedBlocking = frontMatter?.blocking_findings === undefined
    ? null
    : parseInteger(frontMatter.blocking_findings, 'blocking_findings');
  const statedReview = frontMatter?.review_findings === undefined ? null : parseInteger(frontMatter.review_findings, 'review_findings');
  if (statedBlocking !== null && statedBlocking !== actualBlocking) {
    notes.push(`front matter 的 blocking_findings=${statedBlocking} 与正文的 ${actualBlocking} 条不一致：按正文计`);
  }
  if (statedReview !== null && statedReview !== actualReview) {
    notes.push(`front matter 的 review_findings=${statedReview} 与正文的 ${actualReview} 条不一致：按正文计`);
  }
  const statedResult = frontMatter?.result;
  if (statedResult !== undefined && !RESULTS.has(statedResult)) {
    throw new Error('result must be PASS, REVIEW, BLOCK, or INVALID');
  }
  const derivedResult = actualBlocking > 0 ? 'BLOCK' : findings.length > 0 ? 'REVIEW' : 'PASS';
  if (statedResult !== undefined && statedResult !== derivedResult) {
    // PASS/REVIEW 之间不算矛盾（都是「没有阻断」）；BLOCK 与 findings 冲突才算。
    const conflicts = derivedResult === 'BLOCK' || statedResult === 'BLOCK';
    if (conflicts) notes.push(`front matter 的 result=${statedResult} 与正文的 ${derivedResult} 不一致：按正文计`);
  }
  const result = derivedResult;

  return { result, blockingFindings: actualBlocking, reviewFindings: actualReview, changedPlugins, findings, notes, markdown: normalizedMarkdown };
}
