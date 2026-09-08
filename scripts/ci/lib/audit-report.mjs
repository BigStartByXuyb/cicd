const RESULTS = new Set(['PASS', 'REVIEW', 'BLOCK', 'INVALID']);
const SEVERITIES = new Set(['BLOCK', 'REVIEW']);

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error('audit report is missing front matter');

  const values = {};
  const lines = match[1].split(/\r?\n/);
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

function parseInteger(value, field) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${field} must be an integer`);
  return Number(value);
}

export function parseAuditReport(markdown) {
  const frontMatter = parseFrontMatter(markdown);
  const result = frontMatter.result;
  if (!RESULTS.has(result)) throw new Error('result must be PASS, REVIEW, BLOCK, or INVALID');
  if (String(frontMatter.audit_version) !== '1') throw new Error('unsupported audit_version');

  const blockingFindings = parseInteger(frontMatter.blocking_findings, 'blocking_findings');
  const reviewFindings = parseInteger(frontMatter.review_findings, 'review_findings');
  const changedPlugins = Array.isArray(frontMatter.changed_plugins) ? frontMatter.changed_plugins : [];
  for (const section of ['# Plugin Semantic Audit', '## Summary', '## Findings', '## Non-blocking observations', '## Audit limitations']) {
    if (!markdown.includes(section)) throw new Error(`audit report is missing ${section}`);
  }

  const findings = [];
  const headings = [...markdown.matchAll(/^### \[((?:BLOCK)|(?:REVIEW))-\d+\] .+$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].index;
    const end = headings[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    const severity = block.match(/^- Severity: `([^`]+)`$/m)?.[1];
    const confidence = block.match(/^- Confidence: `([^`]+)`$/m)?.[1];
    const evidence = [...block.matchAll(/`([^`\r\n]+:\d+)`/g)].map((match) => match[1]);
    if (!SEVERITIES.has(severity)) throw new Error('finding severity is invalid');
    if (!confidence) throw new Error('finding confidence is missing');
    if (severity === 'BLOCK' && confidence !== 'high') {
      throw new Error('BLOCK finding must have high confidence');
    }
    if (evidence.length === 0) throw new Error('finding must contain evidence');
    findings.push({ severity, confidence, evidence });
  }

  const actualBlocking = findings.filter((finding) => finding.severity === 'BLOCK').length;
  const actualReview = findings.filter((finding) => finding.severity === 'REVIEW').length;
  if (actualBlocking !== blockingFindings || actualReview !== reviewFindings) {
    throw new Error('finding counts do not match front matter');
  }
  if (result === 'BLOCK' && blockingFindings === 0) throw new Error('BLOCK result requires blocking findings');

  return { result, blockingFindings, reviewFindings, changedPlugins, findings };
}
