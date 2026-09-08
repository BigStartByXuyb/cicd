const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const ALLOWED_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);

export function createDeepSeekClaudeConfig({ baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL } = {}) {
  if (!model) throw new Error('model is required');
  if (!ALLOWED_MODELS.has(model)) throw new Error(`unsupported model: ${model}`);
  return { baseUrl, model };
}
