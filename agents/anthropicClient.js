import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

// Gedeelde factory voor Anthropic-clients met consistente retry-instellingen.
// maxRetries: 5 vangt 529-overloaded fouten op bij hoge API-vraag (bv. nieuwe model-release).
// De SDK wacht automatisch met exponential backoff tussen pogingen.
export function makeClient() {
  return new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000, maxRetries: 5 });
}
