import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePluginIdentity,
  findUnexpectedSkillFiles,
} from './naming-rules.mjs';

test('accepts a plugin name consistently represented by directory, manifest, and marketplace', () => {
  const result = validatePluginIdentity({
    directoryName: 'example-plugin',
    manifestName: 'example-plugin',
    marketplaceName: 'example-plugin',
  });

  assert.deepEqual(result, { valid: true, errors: [] });
});

test('rejects inconsistent or non-kebab-case plugin names', () => {
  const result = validatePluginIdentity({
    directoryName: 'Example_Plugin',
    manifestName: 'example-plugin',
    marketplaceName: 'other-plugin',
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    'directoryName must use lowercase kebab-case',
    'directoryName must equal manifestName',
    'directoryName must equal marketplaceName',
  ]);
});

test('flags nested SKILL.md files instead of treating them as public skills', () => {
  const files = [
    'skills/public-skill/SKILL.md',
    'references/adapters/mw-wpf/SKILL.md',
    'examples/SKILL.md',
    'skills/another-skill/README.md',
  ];

  assert.deepEqual(findUnexpectedSkillFiles(files), [
    'references/adapters/mw-wpf/SKILL.md',
    'examples/SKILL.md',
  ]);
});
