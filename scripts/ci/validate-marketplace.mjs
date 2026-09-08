import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePluginIdentity, findUnexpectedSkillFiles } from './lib/naming-rules.mjs';

function walkFiles(root, base = root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(absolute, base));
    else result.push(path.relative(base, absolute).replaceAll('\\', '/'));
  }
  return result;
}

function parseArgs(argv) {
  const rootIndex = argv.indexOf('--root');
  return { root: path.resolve(argv[rootIndex + 1] ?? process.cwd()) };
}

export function validateMarketplace(root) {
  const errors = [];
  const marketplacePath = path.join(root, '.claude-plugin', 'marketplace.json');
  if (!fs.existsSync(marketplacePath)) {
    return { valid: false, errors: ['missing .claude-plugin/marketplace.json'], plugins: [] };
  }

  let marketplace;
  try {
    marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  } catch (error) {
    return { valid: false, errors: [`invalid marketplace JSON: ${error.message}`], plugins: [] };
  }

  const plugins = [];
  for (const entry of marketplace.plugins ?? []) {
    const source = String(entry.source ?? '');
    const relativePluginPath = source.replace(/^\.\//, '');
    const pluginRoot = path.join(root, relativePluginPath);
    const directoryName = path.basename(pluginRoot);
    const manifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      errors.push(`${source}: missing .claude-plugin/plugin.json`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      errors.push(`${source}: invalid plugin.json: ${error.message}`);
      continue;
    }

    const identity = validatePluginIdentity({
      directoryName,
      manifestName: manifest.name,
      marketplaceName: entry.name,
    });
    errors.push(...identity.errors.map((error) => `${source}: ${error}`));

    const unexpected = findUnexpectedSkillFiles(walkFiles(pluginRoot));
    errors.push(...unexpected.map((file) => `${source}/${file}: UNEXPECTED_SKILL_FILE; maintainer confirmation required`));
    plugins.push({ name: manifest.name, source, version: manifest.version, unexpectedSkillFiles: unexpected });
  }

  return { valid: errors.length === 0, errors, plugins };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { root } = parseArgs(process.argv.slice(2));
  const result = validateMarketplace(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}
