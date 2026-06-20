import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { formatCandles } from './formatCandles.js';

const SENTIMENT_TOOL = {
  name: 'geef_marktcontext',
  description: 'Sla de marktcontext/sentiment-inschatting vast.',
  input_schema: {
    type: 'object',
    properties: {
      sentiment: { type: 'string', enum: ['risk-on', 'risk-off', 'neutraal'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      reasoning: {
        type: 'string',
        description: 'Inschatting van het marktsentiment op basis van het prijsgedrag, in het Nederlands (2-3 zinnen).',
      },
    },
    required: ['sentiment', 'confidence', 'reasoning'],
  },
};

export async function assessSentiment(
  candles,
  _analysis,
  { instrument = 'XAU_USD', granularity = 'H1', events = [], newsContext = '', contextNotes = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const eventsNote = events.length
    ? `\n\nDaarnaast staan binnen 48 uur de volgende bevestigde USD-agendapunten gepland ` +
      `(dit zijn vaststaande feiten, geen nieuws dat je zelf moet verifiëren): ` +
      events.map((e) => `"${e.name}" om ${e.time}`).join(', ') +
      `. Geef aan of en hoe dit het huidige sentiment op korte termijn kan overschaduwen.`
    : '';

  const newsContextNote = newsContext
    ? `\n\nHet team heeft daarnaast de volgende actuele marktcontext meegegeven (behandel dit als ` +
      `een bevestigd feit, in afwijking van de instructie om geen onbevestigd nieuws te claimen): ` +
      `"${newsContext}". Geef aan hoe dit het sentiment beïnvloedt en of het koersgedrag in de ` +
      `candles hiermee overeenkomt.`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [SENTIMENT_TOOL],
    tool_choice: { type: 'tool', name: SENTIMENT_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een macro-econoom en marktsentiment-specialist met diepgaande expertise in ` +
          `edelmetalen en goudmarkten. Je analyseert ${instrument} (${granularity}-candles). ` +
          `Je oordeel is volledig onafhankelijk — je weet niet wat andere teamleden concludeerden.\n\n` +

          `CRUCIALE GOUD-MACRO KENNIS — goud is GEEN standaard risk-on/off asset:\n` +
          `Vier onafhankelijke drijfveren, ranggeschikt op historisch belang:\n` +
          `1. REËLE RENTE (sterkste driver): dalende reële rentes → bullish goud (lagere opportunity ` +
          `cost van niet-rentedragend bezit). Stijgende reële rentes → bearish.\n` +
          `2. DOLLAR (directe inverse correlatie): zwakke dollar → bullish goud; sterke dollar → ` +
          `bearish. Gebruik de dollar- en rentecontext hieronder.\n` +
          `3. SAFE HAVEN (nuance!): geopolitieke crisis of marktpaniek → bullish, MAAR dit veroorzaakt ` +
          `óók dollar-appreciatie (vlucht naar veiligheid in USD). De twee krachten werken dan TEGEN ` +
          `elkaar. Analyseer welke dominant is: als dollar hard stijgt bij paniek, drukt dat goud.\n` +
          `4. INFLATIE HEDGE: stijgende inflatie → bullish, maar hogere nominale rentes volgen → ` +
          `netto-effect hangt af van reële rentes. Hogere inflatie met onveranderde nominale rentes ` +
          `= lagere reële rentes = bullish goud.\n\n` +

          `RISK-ON / RISK-OFF DEFINITIE VOOR GOUD:\n` +
          `• Risk-off bij goud: BEIDE dollar EN reële rentes stijgen → sterkste bearish combinatie\n` +
          `• Risk-on bij goud: dollar verzwakt EN reële rentes dalen → sterkste bullish combinatie\n` +
          `• Gemengd: dollar stijgt maar reële rentes dalen (of vice versa) → neutraal of subtiel\n\n` +

          `Baseer je oordeel op (1) het karakter van de candles (momentum, volatiliteit, trendstructuur) ` +
          `en (2) de dollar- en rentecontext hieronder. Claim geen macro-events die je niet zeker weet.` +
          `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
          formatCandles(candles),
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
