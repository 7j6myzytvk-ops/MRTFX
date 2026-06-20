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
          `Stel concrete stop-loss- en take-profit-prijsniveaus voor die passen bij dit signaal ` +
          `en deze volatiliteit.\n\n` +
          `Richtlijnen voor SL/TP:\n` +
          `- Plaats de SL op een technisch betekenisvol niveau (onder/boven een swing, niet op een ` +
          `willekeurige afstand). Gebruik de gemiddelde range als minimale buffer.\n` +
          `- Streef naar een risk/reward-ratio van 1:1.2 tot 1:2.0. Hogere ratio's (>2.5) betekenen ` +
          `dat de TP te ambitieus is voor een dagsessie-trade in XAU/USD — dit verlaagt de trefkans ` +
          `sterk. Kies liever een realistische TP die eerder geraakt wordt.\n` +
          `- Positiegrootte: koppel dit aan de zekerheid van de analist (${analysis.confidence}%): ` +
          `onder 60% → klein; 60-70% → normaal; boven 70% → groot. ` +
          `Verlaag bij hoge volatiliteit (avg range > 30) altijd één stap.\n\n` +
          `Als een verantwoorde trade gezien de volatiliteit niet mogelijk is (SL te groot, ` +
          `geen logisch TP-niveau), geef dit expliciet aan in je onderbouwing en adviseer klein.` +
          `${eventsNote}${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
