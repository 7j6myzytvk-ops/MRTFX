import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

const GEOPOLITICAL_TOOL = {
  name: 'geef_geopolitieke_analyse',
  description: 'Sla de geopolitieke/nieuws-analyse vast voor XAU/USD.',
  input_schema: {
    type: 'object',
    properties: {
      assessment: {
        type: 'string',
        enum: ['bullish', 'bearish', 'neutraal'],
        description:
          'Impact van actuele events op XAU/USD: bullish (events steunen goud), bearish (events drukken goud), neutraal (gemengd of irrelevant).',
      },
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description:
          'Zekerheid over de impact (0 = geen nieuws of totaal onduidelijk, hoog = duidelijke, eenduidige events).',
      },
      reasoning: {
        type: 'string',
        description:
          'Onderbouwing van je oordeel op basis van de nieuwsberichten, in het Nederlands (2-3 zinnen). Noem concrete events.',
      },
      keyEvents: {
        type: 'array',
        items: { type: 'string' },
        description: 'De 1-3 nieuwsberichten die je oordeel het sterkst bepalen (letterlijke koppen of samenvattingen).',
      },
    },
    required: ['assessment', 'confidence', 'reasoning', 'keyEvents'],
  },
};

// Geeft een standaard-neutraal oordeel terug als er geen nieuws beschikbaar is,
// zodat de boardroom-flow nooit blokkeert op een lege nieuwsfeed.
const NO_NEWS_RESULT = {
  assessment: 'neutraal',
  confidence: 0,
  reasoning: 'Geen actueel nieuws beschikbaar voor deze periode. Geopolitieke stem is inactief.',
  keyEvents: [],
};

export async function assessGeopolitical(
  newsItems = [],
  { instrument = 'XAU_USD', granularity = 'H1' } = {},
) {
  // Geen nieuws → meteen neutraal teruggeven, geen API-call verspillen.
  if (!newsItems || newsItems.length === 0) {
    return NO_NEWS_RESULT;
  }

  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const newsBlock = newsItems
    .map((item) => `- ${item.publishedAt.slice(0, 10)} [${item.source}] ${item.title}`)
    .join('\n');

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [GEOPOLITICAL_TOOL],
    tool_choice: { type: 'tool', name: GEOPOLITICAL_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een geopolitieke en macro-economische nieuwsanalist die specialiseert in ` +
          `de goudmarkt (${instrument}, ${granularity}-candles). ` +
          `Jouw exclusieve taak is het beoordelen van de invloed van actuele nieuws- en geopolitieke ` +
          `events op de goudprijs (XAU/USD).\n\n` +
          `BELANGRIJK:\n` +
          `- Je weet niet wat andere teamleden hebben geconcludeerd — dat is bewust zo.\n` +
          `- Baseer je oordeel UITSLUITEND op de onderstaande nieuwsberichten, niet op ` +
          `de technische koersstructuur (die beoordelen andere specialisten).\n` +
          `- Trek geen conclusies uit candle-patronen of indicatoren — jij kijkt alleen naar events.\n` +
          `- Wees specifiek: noem de concrete berichten die jouw oordeel bepalen.\n` +
          `- Als het nieuws gemengd is, schaalt dat de richting naar neutraal en verlaagt het je ` +
          `zekerheid — vermeld dit expliciet.\n` +
          `- Relevante drijfveren voor goud: oorlogen/vrede, centrale bankuitspraken, inflatie, ` +
          `sancties, geopolitieke spanningen, safe-haven-vraag, dollarbeleid.\n\n` +
          `De onderstaande berichten zijn automatisch gefilterd op goud-relevantie en gesorteerd ` +
          `van meest recent naar oudst:\n\n${newsBlock}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
