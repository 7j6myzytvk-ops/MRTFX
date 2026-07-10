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
      sellTheNewsRisk: {
        type: 'string',
        enum: ['laag', 'matig', 'hoog', 'n.v.t.'],
        description: 'Mate waarin het marktbewegende event al is ingeprijsd: laag=vers (<4u, markt reageerde nog niet volledig), matig=deels ingeprijsd (4-24u of prijs al partieel bewogen), hoog=grotendeels ingeprijsd (>24u of grote prijsmove al achter de rug — reversal-risico), n.v.t.=geen duidelijk event.',
      },
    },
    required: ['assessment', 'confidence', 'reasoning', 'keyEvents', 'sellTheNewsRisk'],
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
          `Je bent een voormalig geopolitiek adviseur bij een sovereign wealth fund, nu senior ` +
          `goud-strateeg met 15 jaar ervaring in het vertalen van geopolitieke events naar ` +
          `marktimpact. Je hebt de Arabische Lente (2010-2011), de Oekraïne-crisis (2014), ` +
          `de COVID-pandemie (2020), de Russische invasie (2022) en de BRICS+-expansie (2023-2025) ` +
          `allemaal direct voor goud-beleggers geanalyseerd. Jouw exclusieve mandaat: de impact van ` +
          `actuele geopolitieke/nieuws-events op goud beoordelen én nabije event-risico's die een ` +
          `lopende trade kunnen omverwerpen signaleren.\n\n` +

          `Je leest GEEN candles, kijkt NIET naar indicatoren en weet NIET wat andere teamleden ` +
          `concludeerden. Monetair beleid (Fed/rente) valt onder de macro-analist. Sessie-timing ` +
          `wordt apart aangeleverd via de context — jij focust op geopolitieke events en event-risico's.\n\n` +

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

          `EVENT-RISICO ANALYSE (je sterkste unieke bijdrage):\n` +
          `Beoordeel of er binnen 48-72 uur geopolitieke of macro-events op de agenda staan die ` +
          `een lopende trade kunnen omverwerpen vóórdat TP geraakt wordt. Gebruik hiervoor de ` +
          `geplande high-impact events hieronder én je kennis van geopolitieke kalenders.\n\n` +

          `BEOORDELING:\n` +
          `- Noem de 1-3 berichten die je oordeel het sterkst bepalen\n` +
          `- Benoem of er nabije event-risico's zijn die de setup kwetsbaar maken\n` +
          `- Als nieuws gemengd is of >48 uur oud: neutraal, lage zekerheid\n` +
          `- Hoge zekerheid alleen bij duidelijk, recent, eenduidig geopolitiek nieuws\n\n` +

          `"SELL THE NEWS" KALIBRATIE (verplicht invullen als sellTheNewsRisk):\n` +
          `Beoordeel hoe ver het marktbewegende event al ingeprijsd is:\n` +
          `• laag: event < 4 uur oud, prijs nog niet volledig gereageerd → impact nog lopend\n` +
          `• matig: event 4–24 uur oud of prijs al partieel bewogen → gedeeltelijk verwerkt\n` +
          `• hoog: event > 24 uur oud of grote prijsmove al achter de rug → reversal-risico bij bevestiging\n` +
          `• n.v.t.: geen duidelijk marktbewegend event aanwijsbaar\n\n` +

          `Nieuws (meest recent eerst):\n${newsBlock}${eventsNote}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
