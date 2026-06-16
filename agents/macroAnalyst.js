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
          `Je bent een marktcontext/sentiment-analist voor ${instrument} (${granularity}-candles). ` +
          `Geef een volledig onafhankelijk oordeel van het marktsentiment - je weet niet wat andere ` +
          `teamleden hebben geconcludeerd en dat is bewust zo. ` +
          `Baseer je inschatting UITSLUITEND op (1) het karakter van de candles hieronder ` +
          `(momentum, volatiliteit, trendstructuur) en (2) de dollar- en rentecontext die het team ` +
          `hieronder meegeeft. Claim geen actueel nieuws of macro-events die je niet zeker weet, ` +
          `tenzij het team dit expliciet meegeeft. ` +
          `Stel je eigen richting vast: is het sentiment risk-on (goud onder druk), ` +
          `risk-off (goud ondersteund) of neutraal? Onderbouw dit met concrete observaties ` +
          `uit de candles en de contextnotities, niet met aannames over de richting van de markt.` +
          `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
          formatCandles(candles),
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
