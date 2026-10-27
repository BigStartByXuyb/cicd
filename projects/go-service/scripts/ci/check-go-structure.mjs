import fs from 'node:fs';
import path from 'node:path';

/*
 * Go 服务仓库的确定性检查。只做机械可判定、每条都能失败、每条对应真实风险的四件事：
 *   1) 仓库契约：go.mod / AGENTS.md 存在，调用方 .gitlab-ci.yml 分发到 go-service；
 *   2) 代码位置：Go 文件只允许在 cmd/、internal/、tools/ 下，package main 只允许在 cmd/；
 *   3) 分层：protocol / drivers / store 不反向依赖上层，internal 不引用 cmd；
 *   4) 源码里没有写死的机器专属路径（deploy/ 的安装样例与 docs/ 除外）。
 * 语义问题（复杂度、冗余、耦合、门禁必要性）不在这里猜，交给 AI 审计。
 *
 * 用法：node check-go-structure.mjs --root <仓库根> [--output <json>] [--markdown <md>]
 */

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = path.resolve(arg('--root', process.cwd()));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'bin', 'dist', 'data', 'logs']);
const GO_ROOTS = ['cmd', 'internal', 'tools'];
const LAYER_RULES = [
  { dir: 'internal/protocol', forbidden: ['internal/center', 'internal/node', 'internal/drivers', 'internal/store'] },
  { dir: 'internal/drivers', forbidden: ['internal/center', 'internal/node'] },
  { dir: 'internal/store', forbidden: ['internal/center', 'internal/node', 'internal/drivers'] },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, out);
    else out.push(target);
  }
  return out;
}

const relative = (file) => path.relative(root, file).replace(/\\/g, '/');
const allFiles = walk(root);
const goFiles = allFiles.filter((file) => file.endsWith('.go'));
const modulePath = (() => {
  const file = path.join(root, 'go.mod');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').match(/^module\s+(\S+)/m)?.[1] ?? null;
})();

function parseImports(text) {
  const imports = [];
  const block = text.match(/^import\s*\(([\s\S]*?)^\)/m);
  if (block) for (const match of block[1].matchAll(/"([^"]+)"/g)) imports.push(match[1]);
  for (const match of text.matchAll(/^import\s+(?:\w+\s+)?"([^"]+)"/gm)) imports.push(match[1]);
  return imports;
}

function requiredFiles() {
  const findings = [];
  for (const file of ['go.mod', 'AGENTS.md', '.gitlab-ci.yml']) {
    if (!fs.existsSync(path.join(root, file))) {
      findings.push({ check: 'repo-contract', kind: 'missing-file', path: file, line: 1, message: `缺少 ${file}：Go 服务仓库必须带模块定义、工程规范与调用方 CI 配置` });
    }
  }
  const dispatcher = path.join(root, '.gitlab-ci.yml');
  if (fs.existsSync(dispatcher)) {
    const text = fs.readFileSync(dispatcher, 'utf8');
    if (!/project:\s*data_ai\/cicd/.test(text) || !/CALLER_CI_SUITE:\s*go-service/.test(text)) {
      findings.push({ check: 'repo-contract', kind: 'wrong-dispatch', path: '.gitlab-ci.yml', line: 1, message: '调用方 .gitlab-ci.yml 必须分发到 data_ai/cicd，且 CALLER_CI_SUITE 为 go-service' });
    }
  }
  return findings;
}

function layout() {
  const findings = [];
  for (const file of goFiles) {
    const rel = relative(file);
    const top = rel.split('/')[0];
    if (!GO_ROOTS.includes(top)) {
      findings.push({ check: 'layout', kind: 'go-file-outside-roots', path: rel, line: 1, message: `Go 文件必须位于 ${GO_ROOTS.join('/、')}/ 下` });
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    if (/^package\s+main\b/m.test(text) && top !== 'cmd') {
      findings.push({ check: 'layout', kind: 'main-outside-cmd', path: rel, line: 1, message: 'package main 只允许出现在 cmd/ 下' });
    }
  }
  return findings;
}

function layering() {
  const findings = [];
  if (!modulePath) return findings;
  for (const file of goFiles) {
    const rel = relative(file);
    const importer = path.posix.dirname(rel);
    for (const imported of parseImports(fs.readFileSync(file, 'utf8'))) {
      if (!imported.startsWith(`${modulePath}/`)) continue;
      const target = imported.slice(modulePath.length + 1);
      if (target.startsWith('cmd/') && importer.startsWith('internal/')) {
        findings.push({ check: 'layering', kind: 'internal-imports-cmd', path: rel, line: 1, message: `${importer} 反向引用了入口层 ${target}` });
      }
      for (const rule of LAYER_RULES) {
        if (importer !== rule.dir && !importer.startsWith(`${rule.dir}/`)) continue;
        for (const forbidden of rule.forbidden) {
          if (target === forbidden || target.startsWith(`${forbidden}/`)) {
            findings.push({ check: 'layering', kind: 'reverse-dependency', path: rel, line: 1, message: `${importer} 反向依赖上层 ${target}` });
          }
        }
      }
    }
  }
  return findings;
}

const HARDCODED = [
  { pattern: /\b[A-Za-z]:\\/, label: 'Windows 盘符路径' },
  { pattern: /file:\/\//, label: 'file:// 地址' },
  { pattern: /\/Users\//, label: '/Users/ 路径' },
  { pattern: /\/home\//, label: '/home/ 路径' },
];

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('<!--');
}

function hardcodedPaths() {
  const findings = [];
  const scopes = ['cmd', 'internal', 'tools', 'web'];
  const files = allFiles.filter((file) => scopes.includes(relative(file).split('/')[0]) && /\.(go|js|mjs|html|css)$/.test(file));
  for (const file of files) {
    const rel = relative(file);
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (isCommentLine(line)) return;
      for (const { pattern, label } of HARDCODED) {
        if (pattern.test(line)) {
          findings.push({ check: 'hardcoded-paths', kind: 'hardcoded-path', path: rel, line: index + 1, message: `出现写死的${label}：换机器会失效，或会写到别人机器上` });
        }
      }
    });
  }
  return findings;
}

const checks = [
  { name: 'repo-contract', title: '仓库契约与调用方分发配置', findings: requiredFiles() },
  { name: 'layout', title: 'Go 代码位置与入口约束', findings: layout() },
  { name: 'layering', title: '分层依赖方向没有被绕过', findings: layering() },
  { name: 'hardcoded-paths', title: '没有写死的机器专属路径', findings: hardcodedPaths() },
];

const findings = checks.flatMap((check) => check.findings);
const report = {
  status: findings.length === 0 ? 'PASS' : 'FAIL',
  root,
  checks: checks.map((check) => ({
    name: check.name,
    title: check.title,
    status: check.findings.length === 0 ? 'PASS' : 'FAIL',
    findings: check.findings
  })),
  findings
};

const markdown = [
  '# Go 服务确定性检查',
  '',
  `结论：${report.status}`,
  '',
  ...report.checks.map((check) => `- ${check.status === 'PASS' ? '✅' : '❌'} ${check.title}（${check.name}）：${check.findings.length} 条`),
  ...(findings.length > 0 ? ['', '## 问题', '', ...findings.map((item) => `- ${item.path}:${item.line} —— ${item.message}`)] : [])
].join('\n');

const outputPath = arg('--output');
if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
const markdownPath = arg('--markdown');
if (markdownPath) fs.writeFileSync(markdownPath, `${markdown}\n`);
process.stdout.write(`${markdown}\n`);
if (report.status !== 'PASS') process.exitCode = 1;
