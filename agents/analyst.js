import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { formatCandles } from './formatCandles.js';

const ANALYSIS_TOOL = {
  name: 'leg_analyse_vast',
  description: 'Sla de technische analyse en het handelssignaal vast.',
  input_schema: {
    type: 'object',
    properties: {
      signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      reasoning: { type: 'string', description: 'Korte onderbouwing in het Nederlands (2-3 zinnen).' },
    },
    required: ['signal', 'confidence', 'reasoning'],
  },
};

const REBUTTAL_TOOL = {
  name: 'geef_weerwoord',
  description: 'Sla de bijgestelde of bevestigde analyse na de teamdiscussie vast.',
  input_schema: {
    type: 'object',
    properties: {
      signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      reasoning: {
        type: 'string',
        description: 'Reactie op de discussie: bevestig of herzie je signaal, in het Nederlands (2-3 zinnen).',
      },
    },
    required: ['signal', 'confidence', 'reasoning'],
  },
};

export async function analyzeCandles(candles, { instrument = 'XAU_USD', granularity = 'H1' } = {}) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een technisch analist voor ${instrument} (${granularity}-candles). ` +
          `Analyseer de volgende candles (oudste eerst) en geef een handelssignaal.\n\n` +
          formatCandles(candles),
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return { instrument, granularity, ...toolUse.input };
}

export async function reviewDiscussion(
  candles,
  analysis,
  { risk, devilsAdvocate, macro },
  { instrument = 'XAU_USD', granularity = 'H1' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [REBUTTAL_TOOL],
    tool_choice: { type: 'tool', name: REBUTTAL_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent de technisch analist voor ${instrument} (${granularity}-candles). ` +
          `Je gaf eerder het signaal "${analysis.signal}" (zekerheid ${analysis.confidence}%) ` +
          `met de onderbouwing: "${analysis.reasoning}". ` +
          `Je collega's reageerden hierop:\n\n` +
          `Risicomanager (SL ${risk.stopLoss}, TP ${risk.takeProfit}, positiegrootte "${risk.positionSize}"): ` +
          `${risk.reasoning}\n\n` +
          `Devil's Advocate (tegen-signaal "${devilsAdvocate.counterSignal}", zekerheid ${devilsAdvocate.counterConfidence}%): ` +
          `${devilsAdvocate.argument}\n\n` +
          `Marktcontext/Sentiment ("${macro.sentiment}", zekerheid ${macro.confidence}%): ${macro.reasoning}\n\n` +
          `Geef je herziene of bevestigde signaal en zekerheid, met een korte reactie op de discussie. ` +
          `Je mag bij je eigen analyse blijven als de tegenargumenten je niet overtuigen.`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
