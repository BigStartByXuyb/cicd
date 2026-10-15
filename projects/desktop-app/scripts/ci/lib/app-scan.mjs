import fs from 'node:fs';
import path from 'node:path';

/*
 * 应用仓库的机械扫描：只看文本，不做语义判断（语义那部分交给 AI 审计）。
 * 每一条都对应一个真实风险：机器专属路径写死 → 换机器就跑不了或写到别人目录；
 * 导出没人用 → 死代码；UI 直接 import 后端实现 → 分层被绕过。
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache']);
const CODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx'];

export function listFiles(root, { dirs = ['.'], extensions = CODE_EXTENSIONS } = {}) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(current, entry.name));
        continue;
      }
      if (!extensions.includes(path.extname(entry.name))) continue;
      out.push(path.join(current, entry.name));
    }
  };
  for (const dir of dirs) {
    const target = path.join(root, dir);
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) walk(target);
    else if (extensions.includes(path.extname(target))) out.push(target);
  }
  return out.sort();
}

export function readLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

// 注释行里出现示例路径不算写死：口径只针对代码。
export function isCommentLine(line) {
  return /^\s*(\/\/|\/\*|\*|#|<!--)/.test(line);
}

// 机器专属路径：Windows 盘符、macOS/Linux 家目录、file:// 前缀。
const MACHINE_PATHS = [
  { name: 'windows-drive', pattern: /(?<![\w.])[A-Za-z]:[\\/]/ },
  { name: 'unix-home', pattern: /(?<![\w.])\/(?:Users|home)\// },
  { name: 'file-url', pattern: /file:\/\// }
];

export function findHardcodedPaths({ root, dirs }) {
  const findings = [];
  for (const file of listFiles(root, { dirs })) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    readLines(file).forEach((line, index) => {
      if (isCommentLine(line)) return;
      for (const { name, pattern } of MACHINE_PATHS) {
        const hit = pattern.exec(line);
        if (!hit) continue;
        findings.push({ check: 'hardcoded-paths', kind: name, path: relative, line: index + 1, message: `代码里写死了机器专属路径：${hit[0]}` });
      }
    });
  }
  return findings;
}

// CommonJS 导出的名字：module.exports = { a, b } / module.exports = fn / exports.a = ...
export function collectExports(source) {
  const names = new Set();
  const objectExport = /module\.exports\s*=\s*\{([\s\S]*?)\}/.exec(source);
  if (objectExport) {
    for (const item of objectExport[1].split(',')) {
      const name = item.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(match[1]);
  return [...names];
}

// 导出名在仓库其它地方出现过吗？只在别的文件里找，本文件自己不算引用。
export function findOrphanExports({ root, libDir, searchDirs }) {
  const findings = [];
  const libFiles = listFiles(root, { dirs: [libDir] });
  // 引用面是「整个仓库」：同目录的兄弟模块互相引用也算（否则每个被兄弟模块用的导出都会被误判）。
  const haystackFiles = [...new Set([...listFiles(root, { dirs: searchDirs }), ...libFiles])];
  const haystacks = new Map();
  for (const file of haystackFiles) haystacks.set(file, fs.readFileSync(file, 'utf8'));
  for (const file of libFiles) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    for (const name of collectExports(fs.readFileSync(file, 'utf8'))) {
      // 允许前面是 `.`：跨模块引用几乎都是 `mod.name(...)` 或 `mod.name`，按裸标识符匹配会全漏。
      const pattern = new RegExp(`(?<![\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`);
      let used = false;
      for (const [other, text] of haystacks) {
        if (other === file) continue;
        if (pattern.test(text)) {
          used = true;
          break;
        }
      }
      if (!used) {
        findings.push({ check: 'orphan-exports', kind: 'orphan-export', path: relative, line: 1, message: `导出 ${name} 在仓库里没有任何引用（死代码或内部实现被误导出）` });
      }
    }
  }
  return findings;
}

// 分层：前端不得直接引用后端实现与入口；后端不得引用前端源码。
export function findLayerViolations({ root, uiDir = 'ui/src', backendDirs = ['lib', 'server.js'] }) {
  const findings = [];
  const importPattern = /(?:from\s+|require\()\s*["']([^"']+)["']/g;
  for (const file of listFiles(root, { dirs: [uiDir] })) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    readLines(file).forEach((line, index) => {
      for (const match of line.matchAll(importPattern)) {
        const spec = match[1];
        const escapesUi = /(?:^|\/)\.\.\/(?:\.\.\/)*lib\//.test(spec) || /(?:^|\/)server\.js$/.test(spec);
        if (escapesUi) {
          findings.push({ check: 'layering', kind: 'ui-imports-backend', path: relative, line: index + 1, message: `前端直接引用后端实现：${spec}` });
        }
      }
    });
  }
  for (const dir of backendDirs) {
    for (const file of listFiles(root, { dirs: [dir] })) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      readLines(file).forEach((line, index) => {
        for (const match of line.matchAll(importPattern)) {
          if (/(?:^|\/)(?:ui)\//.test(match[1])) {
            findings.push({ check: 'layering', kind: 'backend-imports-ui', path: relative, line: index + 1, message: `后端引用前端源码：${match[1]}` });
          }
        }
      });
    }
  }
  return findings;
}

export function summarize(findings) {
  const checks = new Map();
  for (const finding of findings) {
    if (!checks.has(finding.check)) checks.set(finding.check, []);
    checks.get(finding.check).push(finding);
  }
  return checks;
}
