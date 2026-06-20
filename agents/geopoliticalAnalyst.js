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
  { instrument = 'XAU_USD', granularity = 'H1', events = [] } = {},
) {
  // Geen nieuws → meteen neutraal teruggeven, geen API-call verspillen.
  if (!newsItems || newsItems.length === 0) {
    return NO_NEWS_RESULT;
  }

  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const newsBlock = newsItems
    .map((item) => `- ${item.publishedAt.slice(0, 16).replace('T', ' ')} UTC [${item.source}] ${item.title}`)
    .join('\n');

  const eventsNote = events.length
    ? `\n\nGEPLANDE HIGH-IMPACT EVENTS (komende 48 uur):\n` +
      events.map((e) => `- ${e.name} om ${e.time}`).join('\n') +
      `\nBeoordeel of deze aankomende events het signaal kunnen omverwerpen vóórdat TP geraakt wordt.`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 768,
    tools: [GEOPOLITICAL_TOOL],
    tool_choice: { type: 'tool', name: GEOPOLITICAL_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een senior geopolitiek strateeg en timing-analist voor ${instrument} ` +
          `(${granularity}-candles). Jouw exclusieve mandaat: twee dingen beoordelen die ` +
          `geen andere agent doet — (1) de impact van actuele geopolitieke/nieuws-events op goud, ` +
          `en (2) de huidige sessie-timing en nabije event-risico's.\n\n` +

          `Je leest GEEN candles, kijkt NIET naar indicatoren en weet NIET wat andere teamleden ` +
          `concludeerden. Monetair beleid (Fed/rente) valt onder de macro-analist — jij fokus op ` +
          `geopolitiek en timing.\n\n` +

          `GEOPOLITIEKE GOUD-DRIVERS (focus op niet-monetaire events):\n` +
          `1. CENTRALE BANK GOUD-AANKOPEN — structurele vraagdriver: grote aankopen door China, ` +
          `Rusland, Turkije, India steunen de goudprijs structureel\n` +
          `2. GEOPOLITIEKE CRISES — oorlogen, sancties, staatsgrepen, grensconflicten → ` +
          `safe-haven-vraag voor goud. Let op: crisis → ook dollar-appreciatie. Analyseer ` +
          `welke kracht wint: als dollar heel hard stijgt, drukken ze elkaar.\n` +
          `3. SUPPLY DISRUPTIONS — oliecrises, Straat van Hormuz, handelsroute-blokkades → ` +
          `inflatie-angst → indirect bullish goud\n` +
          `4. SANCTIES/DEDOLLARISERING — landen die USD-reserves mijden kopen goud als alternatief\n` +
          `5. SENTIMENT-EVENTS — G7/G20-verklaringen, IMF-rapporten, centrale bank goud-beleid ` +
          `(niet rente, maar houding t.o.v. goudreserves)\n` +
          `6. "SELL THE NEWS" RISICO — als een positief event al weken in de markt ingeprijsd is, ` +
          `kan de bevestiging juist een verkoopgolf triggeren\n\n` +

          `SESSIE & TIMING ANALYSE — leid de huidige tijd af uit het tijdstip van het meest ` +
          `recente nieuwsbericht (bovenaan de lijst):\n` +
          `• Asian sessie (00:00-07:00 UTC): lage liquiditeit, accumulatie/range — signalen hier ` +
          `zijn minder betrouwbaar, geen directioneel momentum\n` +
          `• London Kill Zone (07:00-10:00 UTC): manipulatiefase — valse breakouts (Judas Swings) ` +
          `zijn normaal; entry hier zonder bevestiging = hoog risico\n` +
          `• New York Kill Zone (12:00-15:00 UTC): echte institutionele beweging, hoogste liquiditeit ` +
          `— meest betrouwbare window voor entries\n` +
          `• London Close (15:00-17:00 UTC): posities worden gesloten, tijdelijke reversals mogelijk\n` +
          `Verwerk de sessie in je zekerheid: zelfde nieuws in NY Kill Zone = betrouwbaarder dan ` +
          `in London Kill Zone zonder verdere bevestiging.\n\n` +

          `BEOORDELING:\n` +
          `- Noem de 1-3 berichten die je oordeel het sterkst bepalen\n` +
          `- Benoem expliciet in welke sessie we ons bevinden en wat dat betekent voor betrouwbaarheid\n` +
          `- Als nieuws gemengd is of >48 uur oud: neutraal, lage zekerheid\n` +
          `- Hoge zekerheid alleen bij duidelijk, recent, eenduidig geopolitiek nieuws\n\n` +

          `Nieuws (meest recent eerst):\n${newsBlock}${eventsNote}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
