const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEFAULT_MODEL = 'deepseek-flash';
const ALLOWED_MODELS = new Set(['deepseek-flash']);

export function createDeepSeekClaudeConfig({ baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL } = {}) {
  if (!model) throw new Error('model is required');
  if (!ALLOWED_MODELS.has(model)) throw new Error(`unsupported model: ${model}`);
  return { baseUrl, model };
}
