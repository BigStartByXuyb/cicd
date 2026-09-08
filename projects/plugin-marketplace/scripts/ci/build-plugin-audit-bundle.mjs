import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TEXT_EXTENSIONS = new Set(['.json', '.md', '.mjs', '.js', '.cjs', '.ps1', '.yaml', '.yml', '.xml', '.txt', '.svg', '.xaml']);

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

function parseArgs(argv) {
  const values = { root: process.cwd(), contractRoot: process.cwd(), output: path.join(process.cwd(), 'audit-bundle.md'), pluginNames: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--root') { values.root = value; index += 1; }
    else if (flag === '--contract-root') { values.contractRoot = value; index += 1; }
    else if (flag === '--output') { values.output = value; index += 1; }
    else if (flag === '--plugin') { values.pluginNames.push(value); index += 1; }
  }
  return { ...values, root: path.resolve(values.root), contractRoot: path.resolve(values.contractRoot), output: path.resolve(values.output) };
}

export function buildAuditBundle({ root, contractRoot = root, pluginNames }) {
  const marketplace = fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8');
  const contract = fs.readFileSync(path.join(contractRoot, 'docs', 'plugin-semantic-audit.md'), 'utf8');
  const sections = [
    `=== AUDIT CONTRACT (TRUSTED) ===\n${contract}`,
    `=== MARKETPLACE ===\n${marketplace}`,
  ];

  for (const pluginName of pluginNames) {
    const pluginRoot = path.join(root, 'plugins', pluginName);
    const files = walkFiles(pluginRoot).sort();
    const content = files
      .filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()))
      .map((file) => {
        const relative = path.relative(root, file).replaceAll('\\', '/');
        return `--- ${relative} ---\n${fs.readFileSync(file, 'utf8')}`;
      })
      .join('\n');
    sections.push(`=== PLUGIN ${pluginName} ===\n${content}`);
  }

  return `${sections.join('\n\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  fs.writeFileSync(args.output, buildAuditBundle(args), 'utf8');
  process.stdout.write(`${args.output}\n`);
}
