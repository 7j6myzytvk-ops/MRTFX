import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

const RISK_TOOL = {
  name: 'bepaal_risico',
  description: 'Sla het risicobeheer-advies vast.',
  input_schema: {
    type: 'object',
    properties: {
      stopLoss: { type: 'number', description: 'Voorgestelde stop-loss prijs.' },
      takeProfit: { type: 'number', description: 'Voorgestelde take-profit prijs.' },
      positionSize: { type: 'string', enum: ['klein', 'normaal', 'groot'] },
      reasoning: { type: 'string', description: 'Korte onderbouwing in het Nederlands (2-3 zinnen).' },
    },
    required: ['stopLoss', 'takeProfit', 'positionSize', 'reasoning'],
  },
};

function averageRange(candles) {
  const ranges = candles.map((c) => c.high - c.low);
  return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
}

export async function assessRisk(
  candles,
  analysis,
  { instrument = 'XAU_USD', granularity = 'H1', events = [], newsContext = '', contextNotes = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const lastClose = candles[candles.length - 1].close;
  const avgRange = averageRange(candles);

  const eventsNote = events.length
    ? `\n\nLet op: binnen 48 uur staan de volgende belangrijke USD-economische events gepland: ` +
      events.map((e) => `"${e.name}" om ${e.time}`).join(', ') +
      `. Houd rekening met verhoogde volatiliteit rond deze tijdstippen bij je SL/TP- en ` +
      `positiegrootte-advies.`
    : '';

  const newsContextNote = newsContext
    ? `\n\nLet op: het team heeft de volgende actuele marktcontext meegegeven (behandel als ` +
      `bevestigd feit): "${newsContext}". Houd rekening met mogelijk verhoogde volatiliteit ` +
      `hierdoor bij je SL/TP- en positiegrootte-advies.`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [RISK_TOOL],
    tool_choice: { type: 'tool', name: RISK_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een risicomanager voor ${instrument} (${granularity}-candles). ` +
          `De huidige prijs is ${lastClose}. ` +
          `Een analist gaf het signaal "${analysis.signal}" (zekerheid ${analysis.confidence}%) ` +
          `met de onderbouwing: "${analysis.reasoning}". ` +
          `De gemiddelde candle-range (volatiliteit) over de laatste ${candles.length} candles ` +
          `is ${avgRange.toFixed(2)}. ` +
          `Stel concrete stop-loss- en take-profit-prijsniveaus voor die passen bij dit ` +
          `signaal en deze volatiliteit, en geef een positiegrootte-advies. ` +
          `Beoordeel daarnaast de kwaliteit van de trade: is de verhouding tussen de TP-afstand ` +
          `en de SL-afstand gunstig? Is de volatiliteit op dit moment zo hoog dat een verantwoorde ` +
          `trade nauwelijks mogelijk is? Als dat het geval is, geef dit dan expliciet aan in je ` +
          `onderbouwing en adviseer de kleinste positiegrootte — de CEO weegt dit mee in het ` +
          `uiteindelijke besluit.${eventsNote}${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
