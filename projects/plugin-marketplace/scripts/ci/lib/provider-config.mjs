const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';
// Claude Code validates model names locally. Use a recognized Claude Sonnet
// alias; DeepSeek's Anthropic-compatible endpoint maps claude-sonnet-* to V4 Flash.
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-opus-4-6']);

export function createDeepSeekClaudeConfig({ baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL } = {}) {
  if (!model) throw new Error('model is required');
  if (!ALLOWED_MODELS.has(model)) throw new Error(`unsupported model: ${model}`);
  return { baseUrl, model };
}
