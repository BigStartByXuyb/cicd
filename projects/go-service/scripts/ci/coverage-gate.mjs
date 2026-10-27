import fs from 'node:fs';
import path from 'node:path';

/*
 * Go 覆盖率门禁。统计范围默认 internal/（cmd/ 是装配入口，靠端到端验证），
 * 阈值默认总覆盖率 70%、单包 60%，可由调用方 ci/coverage.json 覆盖：
 *   { "overall_min": 70, "package_min": 60, "scope": "internal/", "package_min_statements": 10 }
 * 用法：node coverage-gate.mjs --file <coverage.out> --root <仓库根> [--config <json>]
 *        --output-json <json> --output-text <txt>
 */

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const coveragePath = arg('--file');
const root = path.resolve(arg('--root', process.cwd()));
const outputJsonPath = arg('--output-json');
const outputTextPath = arg('--output-text');
if (!coveragePath) throw new Error('--file is required');

const defaults = { overall_min: 70, package_min: 60, scope: 'internal/', package_min_statements: 10 };
const configPath = arg('--config', path.join(root, 'ci', 'coverage.json'));
const config = fs.existsSync(configPath) ? { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) } : defaults;

const modulePath = (() => {
  const file = path.join(root, 'go.mod');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').match(/^module\s+(\S+)/m)?.[1] ?? null;
})();

// go coverprofile 每行：模块内文件:起.列,止.列 语句数 命中次数（首行是 mode:）。
const LINE = /^(.+?):\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)$/;
const totals = new Map();

if (fs.existsSync(coveragePath)) {
  for (const line of fs.readFileSync(coveragePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('mode:')) continue;
    const match = line.match(LINE);
    if (!match) continue;
    const [, file, statements, hits] = match;
    const rel = modulePath && file.startsWith(`${modulePath}/`) ? file.slice(modulePath.length + 1) : file.replace(/^\.\//, '');
    if (!rel.startsWith(config.scope)) continue;
    const packageName = path.posix.dirname(rel);
    const item = totals.get(packageName) ?? { statements: 0, covered: 0 };
    item.statements += Number(statements);
    if (Number(hits) > 0) item.covered += Number(statements);
    totals.set(packageName, item);
  }
}

const packages = [...totals.entries()]
  .map(([name, item]) => ({
    package: name,
    statements: item.statements,
    covered: item.covered,
    percent: item.statements === 0 ? 0 : Math.round((item.covered / item.statements) * 1000) / 10,
    status: item.statements >= config.package_min_statements && item.covered / item.statements * 100 < config.package_min ? 'FAIL' : 'PASS'
  }))
  .sort((a, b) => a.package.localeCompare(b.package));

const totalStatements = packages.reduce((sum, item) => sum + item.statements, 0);
const totalCovered = packages.reduce((sum, item) => sum + item.covered, 0);
const overall = totalStatements === 0 ? 0 : Math.round((totalCovered / totalStatements) * 1000) / 10;

const status = totalStatements > 0 && overall >= config.overall_min && packages.every((item) => item.status === 'PASS')
  ? 'PASS'
  : 'FAIL';
const report = {
  status,
  scope: config.scope,
  overall,
  overall_min: config.overall_min,
  package_min: config.package_min,
  package_min_statements: config.package_min_statements,
  total_statements: totalStatements,
  covered_statements: totalCovered,
  packages,
  ...(totalStatements === 0 ? { error: `覆盖率报告里没有 ${config.scope} 下的语句：先跑 go test -coverprofile` } : {})
};

const text = [
  '# Go 覆盖率门禁',
  '',
  `结论：${status}`,
  `范围：${config.scope}（总覆盖率下限 ${config.overall_min}%，单包下限 ${config.package_min}%，包内语句数 ≥${config.package_min_statements} 才单独卡）`,
  `总覆盖率：${overall}%（${totalCovered}/${totalStatements} 条语句）`,
  '',
  '## 各包',
  '',
  ...(packages.length > 0
    ? packages.map((item) => `- ${item.status === 'PASS' ? '✅' : '❌'} ${item.package}：${item.percent}%（${item.covered}/${item.statements}）`)
    : ['- （没有可统计的包）']),
  ...(report.error ? ['', `错误：${report.error}`] : [])
].join('\n');

if (outputJsonPath) fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
if (outputTextPath) fs.writeFileSync(outputTextPath, `${text}\n`);
process.stdout.write(`${text}\n`);
if (status !== 'PASS') process.exitCode = 1;
