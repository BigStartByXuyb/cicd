const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validatePluginIdentity({ directoryName, manifestName, marketplaceName }) {
  const errors = [];

  if (!NAME_PATTERN.test(directoryName)) {
    errors.push('directoryName must use lowercase kebab-case');
  }
  if (directoryName !== manifestName) {
    errors.push('directoryName must equal manifestName');
  }
  if (directoryName !== marketplaceName) {
    errors.push('directoryName must equal marketplaceName');
  }

  return { valid: errors.length === 0, errors };
}

export function findUnexpectedSkillFiles(files) {
  return files
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('/SKILL.md') && !/^skills\/[^/]+\/SKILL\.md$/.test(file));
}
