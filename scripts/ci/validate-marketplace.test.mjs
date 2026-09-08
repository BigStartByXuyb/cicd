import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateMarketplace } from './validate-marketplace.mjs';

test('reports nested SKILL.md as a structural anomaly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-marketplace-'));
  try {
    fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', 'example-plugin', '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', 'example-plugin', 'skills', 'main', 'references', 'adapters', 'legacy'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'example-plugin', source: './plugins/example-plugin' }] }));
    fs.writeFileSync(path.join(root, 'plugins', 'example-plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'example-plugin', version: '1.0.0' }));
    fs.writeFileSync(path.join(root, 'plugins', 'example-plugin', 'skills', 'main', 'SKILL.md'), '# Main');
    fs.writeFileSync(path.join(root, 'plugins', 'example-plugin', 'skills', 'main', 'references', 'adapters', 'legacy', 'SKILL.md'), '# Legacy reference');

    const result = validateMarketplace(root);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('UNEXPECTED_SKILL_FILE')));
    assert.ok(result.errors.some((error) => error.includes('legacy/SKILL.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
