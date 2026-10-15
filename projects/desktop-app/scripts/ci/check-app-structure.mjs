import fs from 'node:fs';
import path from 'node:path';

import { findHardcodedPaths, findLayerViolations, findOrphanExports } from './lib/app-scan.mjs';

/*
 * 应用仓库的确定性检查：只做机械可判定的三件事，全部能失败、全部对应真实风险。
 *   1) 硬编码机器专属路径 —— 换机器跑不了，或者悄悄写到别人的目录；
 *   2) 孤儿导出 —— 没人引用的导出就是死代码，改它也没人知道；
 *   3) 分层 —— UI 直接碰后端实现，或后端反向引用 UI，都是绕过既有接口。
 * 语义类问题（函数复杂度、冗余、门禁是否必要、耦合）不在这里猜，交给 AI 审计。
 *
 * 用法：node check-app-structure.mjs --root <仓库根> [--output <json>] [--markdown <md>]
 */

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

/*
 * 调用方 workflow 里的 pin 有两个出现位置（`uses:` 与 `ci_ref:`）——GitHub 不允许 `uses:` 用变量，
 * 所以无法合成一处。这里把它们钉成「必须一致且必须是 commit SHA」，改一处漏另一处会当场失败。
 */
function findCiPinMismatch(root) {
  const file = path.join(root, '.github', 'workflows', 'ci.yml');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const used = text.match(/uses:\s*\S+@([^\s]+)/)?.[1] ?? '';
  const declared = text.match(/^\s*ci_ref:\s*([^\s]+)/m)?.[1] ?? '';
  const findings = [];
  const relative = '.github/workflows/ci.yml';
  if (!used || !declared) {
    findings.push({ check: 'ci-pin', kind: 'missing-pin', path: relative, line: 1, message: 'workflow 缺少 uses@<ref> 或 ci_ref 入参，无法固定 CI 版本' });
    return findings;
  }
  if (used !== declared) {
    findings.push({ check: 'ci-pin', kind: 'pin-mismatch', path: relative, line: 1, message: `uses 的 ${used} 与 ci_ref 的 ${declared} 不一致：改 pin 要两处一起改` });
  }
  if (!/^[0-9a-f]{40}$/.test(used)) {
    findings.push({ check: 'ci-pin', kind: 'unpinned', path: relative, line: 1, message: `CI 版本 ${used} 不是 commit SHA：分支/标签会漂移，门禁会被上游静默改掉` });
  }
  return findings;
}

const root = path.resolve(arg('--root', process.cwd()));
if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error(`--root 不是应用仓库根（缺 package.json）：${root}`);

const checks = [
  {
    name: 'hardcoded-paths',
    title: '没有写死的机器专属路径',
    findings: findHardcodedPaths({ root, dirs: ['lib', 'server.js', 'ui/src'] })
  },
  {
    name: 'orphan-exports',
    title: '没有没人引用的导出',
    findings: findOrphanExports({ root, libDir: 'lib', searchDirs: ['server.js', 'lib', 'tests', 'ui/src'] })
  },
  {
    name: 'layering',
    title: '前后端分层没有被绕过',
    findings: findLayerViolations({ root })
  },
  {
    name: 'ci-pin',
    title: 'CI 版本钉死且两处一致',
    findings: findCiPinMismatch(root)
  }
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
  '# 应用确定性检查',
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
