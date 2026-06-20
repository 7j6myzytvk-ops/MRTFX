import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { formatCandles } from './formatCandles.js';

const CHALLENGE_TOOL = {
  name: 'lever_tegenargument',
  description: 'Sla het tegenargument tegen het analist-signaal vast.',
  input_schema: {
    type: 'object',
    properties: {
      counterSignal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
      counterConfidence: { type: 'integer', minimum: 0, maximum: 100 },
      argument: {
        type: 'string',
        description: 'Het sterkste tegenargument tegen het analist-signaal, in het Nederlands (2-3 zinnen).',
      },
    },
    required: ['counterSignal', 'counterConfidence', 'argument'],
  },
};

export async function challengeAnalysis(
  candles,
  analysis,
  { instrument = 'XAU_USD', granularity = 'H1', events = [], newsContext = '', contextNotes = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const eventsNote = events.length
    ? `\n\nLet op: binnen 48 uur staan de volgende marktbewegende USD-events gepland: ` +
      events.map((e) => `"${e.name}" om ${e.time}`).join(', ') +
      `. Een aankomend groot event is op zichzelf al een sterk tegenargument: ` +
      `technische setups kunnen binnen uren worden omgekeerd door onverwachte uitkomsten.`
    : '';

  const newsContextNote = newsContext
    ? `\n\nHet team heeft de volgende actuele marktcontext meegegeven (behandel als bevestigd ` +
      `feit): "${newsContext}". Overweeg ook of de markt hierop al overdreven kan hebben ` +
      `gereageerd ("sell the news") of dat dit juist nog niet volledig in de prijs verwerkt is.`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [CHALLENGE_TOOL],
    tool_choice: { type: 'tool', name: CHALLENGE_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een Bear Researcher — een risicospecialist in de institutionele goudmarkt ` +
          `(${instrument}, ${granularity}-candles) die is aangesteld om het sterkste bearish ` +
          `scenario te identificeren vóórdat het team een besluit neemt.\n\n` +

          `Een analist gaf het signaal "${analysis.signal}" (zekerheid ${analysis.confidence}%) ` +
          `met onderbouwing: "${analysis.reasoning}".\n\n` +

          `JOUW MANDAAT — eerlijk, niet kunstmatig negatief:\n` +
          `Zoek het sterkste bewijs dat deze trade fout is of het risico niet waard. Kijk specifiek naar:\n` +
          `• Tegengestelde marktstructuur: is het signaal een counter-trend trade?\n` +
          `• Liquiditeitsvallen: staat de entry boven/onder een cluster gelijke highs/lows die ` +
          `een stop hunt uitlokken?\n` +
          `• Macro-tegenwind: dollar-trend, renteklimaat of aankomend event dat de richting kan ` +
          `omgooien?\n` +
          `• Overbought/oversold extremen die een reversal aannemelijk maken?\n` +
          `• Zwakke entry: geen duidelijke trigger, te laat in de beweging, slechte R:R-positie?\n\n` +

          `EERLIJKHEID IS WAARDEVOLLER DAN OPPOSITIE:\n` +
          `Als je na serieus kritisch kijken werkelijk geen sterk bearish argument kunt vinden, ` +
          `dan is een lage counter-zekerheid met duidelijke toelichting de meest waardevolle ` +
          `uitkomst. Forceer geen tegenargument — een eerlijk "de setup is sterk, het grootste ` +
          `restrisico is X" is méér waard dan kunstmatige twijfel. Je counter-zekerheid mag ` +
          `laag zijn als dat de eerlijke conclusie is.` +
          `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
          formatCandles(candles),
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
