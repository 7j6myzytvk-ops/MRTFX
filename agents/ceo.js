import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

const DECISION_TOOL = {
  name: 'neem_besluit',
  description: 'Sla het definitieve besluit van het team vast.',
  input_schema: {
    type: 'object',
    properties: {
      signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      stopLoss: { type: 'number', description: 'Definitieve stop-loss prijs.' },
      takeProfit: { type: 'number', description: 'Definitieve take-profit prijs.' },
      positionSize: { type: 'string', enum: ['klein', 'normaal', 'groot'] },
      reasoning: {
        type: 'string',
        description: 'Eindoordeel met verwijzing naar de discussie, in het Nederlands (3-5 zinnen).',
      },
    },
    required: ['signal', 'confidence', 'stopLoss', 'takeProfit', 'positionSize', 'reasoning'],
  },
};

export async function decide(
  candles,
  { analysis, risk, devilsAdvocate, macro, rebuttal },
  { instrument = 'XAU_USD', granularity = 'H1', newsContext = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const lastClose = candles[candles.length - 1].close;

  const newsContextNote = newsContext
    ? `\n\nLet op: het team heeft daarnaast de volgende actuele marktcontext meegegeven (behandel ` +
      `als bevestigd feit): "${newsContext}". Weeg dit mee in je eindbesluit.`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    tools: [DECISION_TOOL],
    tool_choice: { type: 'tool', name: DECISION_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent de CEO van een handelsteam voor ${instrument} (${granularity}-candles). ` +
          `De huidige prijs is ${lastClose}. Je team heeft het volgende besproken:\n\n` +
          `1) Analist (eerste analyse): signaal "${analysis.signal}" (zekerheid ${analysis.confidence}%) - ` +
          `${analysis.reasoning}\n\n` +
          `2) Risicomanager: SL ${risk.stopLoss}, TP ${risk.takeProfit}, positiegrootte "${risk.positionSize}" - ` +
          `${risk.reasoning}\n\n` +
          `3) Devil's Advocate: tegen-signaal "${devilsAdvocate.counterSignal}" ` +
          `(zekerheid ${devilsAdvocate.counterConfidence}%) - ${devilsAdvocate.argument}\n\n` +
          `4) Marktcontext/Sentiment: "${macro.sentiment}" (zekerheid ${macro.confidence}%) - ${macro.reasoning}\n\n` +
          `5) Analist (weerwoord na de discussie): signaal "${rebuttal.signal}" (zekerheid ${rebuttal.confidence}%) - ` +
          `${rebuttal.reasoning}\n\n` +
          `Neem het definitieve besluit voor het team: signaal, zekerheid, concrete stop-loss- en ` +
          `take-profit-prijzen en een positiegrootte-advies. Je mag afwijken van de analist als de ` +
          `discussie dat rechtvaardigt - leg in je onderbouwing uit hoe je de verschillende ` +
          `standpunten hebt gewogen.${newsContextNote}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
