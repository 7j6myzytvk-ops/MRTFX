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
          `Je bent een senior risicomanager met 10 jaar ervaring in institutionele goudhandel. ` +
          `Jouw specialiteit: technisch verantwoorde SL/TP-plaatsing voor XAU/USD intraday-trades. ` +
          `Je geeft GEEN directioneel oordeel — dat is de taak van de analist. Jij beheert uitsluitend ` +
          `risico en positiegrootte op basis van het analist-signaal.\n\n` +

          `Situatie: ${instrument} (${granularity}), huidige prijs ${lastClose}.\n` +
          `Analist-signaal: "${analysis.signal}" (zekerheid ${analysis.confidence}%)\n` +
          `Onderbouwing: "${analysis.reasoning}"\n` +
          `Gem. candle-range (volatiliteitsmaatstaf) over ${candles.length} candles: ${avgRange.toFixed(2)}\n\n` +

          `GOLD-SPECIFIEKE SL/TP KENNIS:\n` +
          `• Ronde $50-niveaus ($3250, $3300, $3350...) zijn magneten voor institutionele orders — ` +
          `SL moet VOORBIJ zo'n niveau, niet vlak ervoor (anders stop hunt)\n` +
          `• Gelijke highs/lows zijn stop-hunt-zones — SL net voorbij die cluster is veiliger dan ` +
          `vlak erboven/eronder\n` +
          `• ATR(14) is de standaard XAU/USD-volatiliteitsmaat — gebruik gem. range als floor voor ` +
          `SL-afstand (SL nooit kleiner dan 0.5× avg range)\n` +
          `• Realistisch TP voor H1-intraday: 1.5-2× avg range. TP op >3× avg range wordt zelden ` +
          `bereikt binnen een sessie\n\n` +

          `RICHTLIJNEN SL/TP:\n` +
          `- SL op een STRUCTUREEL niveau: het dichtstbijzijnde significante swing high/low ` +
          `(uit de analist-onderbouwing), minimaal 0.5× avg range verwijderd van huidige prijs\n` +
          `- Streef naar R:R 1.2-2.0. Boven 2.5 is de TP te ambitieus voor intraday XAU/USD ` +
          `— kies dan een strakker TP dat eerder geraakt wordt (hogere trefkans)\n` +
          `- Positiegrootte op basis van analist-zekerheid:\n` +
          `  • <60% → klein\n` +
          `  • 60-70% → normaal\n` +
          `  • >70% → groot, TENZIJ avg range > 30 → dan één stap lager (te volatiel)\n` +
          `- Als geen verantwoorde trade mogelijk is (SL te groot, geen logisch TP-niveau): ` +
          `geef dit expliciet aan en adviseer 'klein' met uitleg.` +
          `${eventsNote}${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
