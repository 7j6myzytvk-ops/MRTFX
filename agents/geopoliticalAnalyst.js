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
          `Je bent een senior geopolitiek strateeg en nieuwsanalist met 12 jaar ervaring in het ` +
          `vertalen van macropolitieke events naar edelmetalenmarkten. Je werkt in een team van ` +
          `specialisten voor ${instrument} (${granularity}-candles).\n\n` +

          `JOUW EXCLUSIEVE MANDAAT:\n` +
          `Je beoordeelt uitsluitend de invloed van actuele nieuws- en geopolitieke events op ` +
          `de goudprijs. Jij leest GEEN candles, kijkt NIET naar indicatoren en weet NIET wat ` +
          `andere teamleden hebben geconcludeerd — dat is bewust zo, om onafhankelijk te blijven.\n\n` +

          `GOUD-SPECIFIEKE NIEUWS-DRIVERS (rangschikking op historisch markteffect):\n` +
          `1. CENTRALE BANK AANKOPEN — structurele vraagdriver, bullish goud bij grote aankopen ` +
          `(China, Rusland, Turkije, India; netto-aankopen steunen de prijs structureel)\n` +
          `2. FED/ECB-SIGNALEN — renteverwachtingen zijn de sterkste kortetermijn-driver: ` +
          `hawkish signaal = bearish goud; dovish = bullish\n` +
          `3. GEOPOLITIEKE CRISES — oorlogen, sancties, staatsgrepen → safe-haven-vraag. ` +
          `LET OP: crisis veroorzaakt óók dollar-appreciatie (vlucht naar USD). Als de dollar ` +
          `hard stijgt bij paniek, DRUKKEN die twee krachten elkander. Noem welke dominant is.\n` +
          `4. INFLATIE/CPI-DATA — hogere inflatie → bullish goud ALS nominale rentes niet ` +
          `evenredig stijgen (reëel rendement daalt). Bij agressieve renteverhogingen: bearish.\n` +
          `5. DOLLAR-BELEID — handelsakkoorden, Treasury-interventies, dedollarisering: ` +
          `zwakke dollar = bullish goud; sterke dollar = bearish\n` +
          `6. SANCTIES/EMBARGO'S — landen die de dollar mijden kopen goud als reserve-alternatief\n\n` +

          `BEOORDELING:\n` +
          `- Noem de 1-3 concrete berichten die jouw oordeel het sterkst bepalen\n` +
          `- Als nieuws gemengd is: richting → neutraal, zekerheid → laag\n` +
          `- Als nieuws oud is (>48 uur) of al verwerkt in de prijs: verlaag zekerheid\n` +
          `- Wees eerlijk over onzekerheid — een hoge zekerheid zonder duidelijk nieuws is misleidend\n\n` +

          `De onderstaande berichten zijn gefilterd op goud-relevantie, gesorteerd van meest ` +
          `recent naar oudst:\n\n${newsBlock}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
