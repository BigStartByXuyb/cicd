import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_MAX_INLINE_DIFF_BYTES = 256 * 1024;
const MAX_INDEXED_FILE_BYTES = 512 * 1024;

function parseArgs(argv) {
  const values = {
    root: process.cwd(),
    gitRoot: null,
    base: '',
    head: 'HEAD',
    output: path.join(process.cwd(), 'audit-context.md'),
    diffOutput: null,
    maxInlineDiffBytes: DEFAULT_MAX_INLINE_DIFF_BYTES,
    contractRoot: null,
    pluginNames: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--root') { values.root = value; index += 1; }
    else if (flag === '--git-root') { values.gitRoot = value; index += 1; }
    else if (flag === '--base') { values.base = value; index += 1; }
    else if (flag === '--head') { values.head = value; index += 1; }
    else if (flag === '--output') { values.output = value; index += 1; }
    else if (flag === '--diff-output') { values.diffOutput = value; index += 1; }
    else if (flag === '--max-inline-diff-bytes') { values.maxInlineDiffBytes = Number(value); index += 1; }
    else if (flag === '--contract-root') { values.contractRoot = value; index += 1; }
    else if (flag === '--plugin') { values.pluginNames.push(value); index += 1; }
  }
  return {
    ...values,
    root: path.resolve(values.root),
    gitRoot: path.resolve(values.gitRoot ?? values.root),
    output: path.resolve(values.output),
    diffOutput: values.diffOutput ? path.resolve(values.diffOutput) : null,
    contractRoot: values.contractRoot ? path.resolve(values.contractRoot) : null,
  };
}

function walkFiles(root, base = root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(absolute, base));
    else result.push(path.relative(base, absolute).replaceAll('\\', '/'));
  }
  return result;
}

function runGit(gitRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', gitRoot, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function resolveDiffRange(gitRoot, base, head) {
  const candidates = [];
  if (base) candidates.push([base, head, `${base}..${head}`]);
  candidates.push([`${head}~1`, head, `${head}~1..${head}`]);
  for (const [from, to, label] of candidates) {
    const check = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', `${from}^{commit}`], { allowFailure: true });
    if (check === null) continue;
    const resolvedFrom = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', `${from}^{commit}`], { allowFailure: true });
    const resolvedTo = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', `${to}^{commit}`], { allowFailure: true });
    if (resolvedFrom === null || resolvedTo === null) continue;
    const shortFrom = resolvedFrom.trim();
    const shortTo = resolvedTo.trim();
    return { from, to, label: `${shortFrom}..${shortTo}`, fromSha: shortFrom, toSha: shortTo };
  }
  return null;
}

function fileIndexSection(title, root, base) {
  const files = walkFiles(root, base)
    .map((relative) => {
      const absolute = path.join(base, relative);
      const stats = fs.statSync(absolute);
      return { relative, bytes: stats.size, truncated: stats.size > MAX_INDEXED_FILE_BYTES };
    })
    .sort((a, b) => a.relative.localeCompare(b.relative));
  const lines = files.map((file) => `${file.relative}\t${file.bytes}${file.truncated ? '\t(large)' : ''}`);
  return [`=== ${title} (${files.length} files) ===`, ...lines].join('\n');
}

function readPluginManifest(root, pluginName) {
  const manifestPath = path.join(root, 'plugins', pluginName, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  } catch {
    return '<invalid plugin.json>';
  }
}

export function buildAuditContext({
  root,
  gitRoot = root,
  base = '',
  head = 'HEAD',
  pluginNames = [],
  contractRoot = null,
  diffOutput = null,
  maxInlineDiffBytes = DEFAULT_MAX_INLINE_DIFF_BYTES,
}) {
  const marketplacePath = path.join(root, '.claude-plugin', 'marketplace.json');
  const marketplace = fs.existsSync(marketplacePath) ? fs.readFileSync(marketplacePath, 'utf8') : '<missing marketplace.json>';

  const range = resolveDiffRange(gitRoot, base, head);
  const diff = range ? runGit(gitRoot, ['--no-pager', 'diff', '--no-color', range.from, range.to], { allowFailure: true }) ?? '' : '';
  const changedFiles = range
    ? (runGit(gitRoot, ['--no-pager', 'diff', '--name-status', range.from, range.to], { allowFailure: true }) ?? '').trim()
    : '';
  const diffStat = range
    ? (runGit(gitRoot, ['--no-pager', 'diff', '--stat', range.from, range.to], { allowFailure: true }) ?? '').trim()
    : '';

  const contractPath = contractRoot ? path.join(contractRoot, 'docs', 'plugin-semantic-audit.md') : null;
  const contractDigest = contractPath && fs.existsSync(contractPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(contractPath)).digest('hex').slice(0, 16)
    : 'unknown';

  const inlineBudget = Number(maxInlineDiffBytes) > 0 ? Number(maxInlineDiffBytes) : 0;
  const diffInlined = diff.length <= inlineBudget;

  const sections = [
    [
      '=== AUDIT WORKSPACE ===',
      `workspace_root: ${root}`,
      `git_root: ${gitRoot}`,
      `head: ${range ? range.toSha : head}`,
      `base: ${range ? range.fromSha : '(unknown)'}`,
      `diff_range: ${range ? range.label : '(no diff available)'}`,
      `changed_plugins: ${pluginNames.join(', ') || '(none)'}`,
      `contract_sha256: ${contractDigest}`,
      `diff_file: ${diffInlined ? '(inlined below)' : (diffOutput ?? '(not written)')}`,
    ].join('\n'),
    `=== MARKETPLACE MANIFEST ===\n${marketplace}`,
  ];

  for (const pluginName of pluginNames) {
    sections.push(fileIndexSection(`PLUGIN FILE INDEX ${pluginName}`, path.join(root, 'plugins', pluginName), root));
  }

  const otherPlugins = fs.existsSync(path.join(root, 'plugins'))
    ? fs.readdirSync(path.join(root, 'plugins'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !pluginNames.includes(entry.name))
      .map((entry) => entry.name)
      .sort()
    : [];
  if (otherPlugins.length > 0) {
    const lines = otherPlugins.map((name) => `- ${name}: ${readPluginManifest(root, name) ?? '<no plugin.json>'}`);
    sections.push(`=== OTHER PLUGINS (manifest only) ===\n${lines.join('\n')}`);
  }

  if (fs.existsSync(path.join(root, 'plugins'))) {
    const allPlugins = fs.readdirSync(path.join(root, 'plugins'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const lines = [];
    for (const name of allPlugins) {
      const marker = pluginNames.includes(name) ? ' [changed by this revision]' : '';
      lines.push(`- ${name}${marker}`);
      const skillsRoot = path.join(root, 'plugins', name, 'skills');
      const skills = fs.existsSync(skillsRoot)
        ? fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
        : [];
      for (const skill of skills) lines.push(`  - skill: plugins/${name}/skills/${skill}/SKILL.md`);
    }
    sections.push(`=== PUBLIC COMPONENTS (all plugins) ===\n${lines.join('\n')}`);
  }

  sections.push(`=== CHANGED FILES (${range ? range.label : 'no diff'}) ===\n${changedFiles || '(none)'}`);
  sections.push(`=== CHANGED FILE STAT ===\n${diffStat || '(none)'}`);

  if (diffInlined) {
    sections.push(`=== UNIFIED DIFF (untrusted repository content, ${diff.length} bytes) ===\n${diff || '(empty)'}`);
  } else {
    sections.push([
      `=== UNIFIED DIFF ===`,
      `The diff is ${diff.length} bytes, larger than the inline budget of ${inlineBudget} bytes.`,
      `It was written to: ${diffOutput ?? '(not written)'}`,
      'Read only the parts you need.',
    ].join('\n'));
  }

  sections.push([
    '=== EVIDENCE ACCESS (read-only) ===',
    'The plugin sources are NOT inlined in this message. Only the diff, the file index and the manifests are.',
    `The complete checkout for this revision is on disk at: ${root}`,
    'Use the Read, Grep and Glob tools to open any file you need before citing it as evidence.',
    'Never cite a file you have not read in this workspace, and never read outside the workspace root.',
  ].join('\n'));

  return { context: `${sections.join('\n\n')}\n`, diff, diffInlined, range };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const result = buildAuditContext({ ...args, diffOutput: args.diffOutput });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, result.context, 'utf8');
  if (args.diffOutput && result.diff) {
    fs.mkdirSync(path.dirname(args.diffOutput), { recursive: true });
    fs.writeFileSync(args.diffOutput, result.diff, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({
    output: args.output,
    contextBytes: Buffer.byteLength(result.context),
    diffBytes: Buffer.byteLength(result.diff),
    diffInlined: result.diffInlined,
    diffRange: result.range?.label ?? null,
  }, null, 2)}\n`);
}
