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
    max_tokens: 1024,
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

          `JOUW MANDAAT: je MOET alle vijf categorieën hieronder doorzoeken en per categorie ` +
          `rapporteren wat je vindt. Doe dit systematisch — niet oppervlakkig. Je bent de laatste ` +
          `verdedigingslinie vóórdat het team een besluit neemt.\n\n` +

          `VERPLICHTE ZOEKGEBIEDEN (doorloop elk, sla niets over):\n\n` +

          `① MARKTSTRUCTUUR TEGEN: Is dit signaal counter-trend t.o.v. de hogere timeframe? ` +
          `Is er een intacte CHoCH (Change of Character) die de andere richting wijst? ` +
          `Beschrijf wat de hogere structuur zegt.\n\n` +

          `② LIQUIDITEITSVAL / JUDAS SWING: Staat de entry BOVEN gelijke highs of ONDER gelijke lows ` +
          `(stop-cluster)? Is dit mogelijk een Judas Swing — een London-fake-out die retail ` +
          `in de verkeerde richting lokt, waarna de echte NY-beweging omgekeerd gaat? ` +
          `Is de entry in een premium-zone (voor longs: te duur) of discount-zone (voor shorts: ` +
          `te goedkoop)?\n\n` +

          `③ MACRO-TEGENWIND: Contradicteert het macro-klimaat (dollar-trend, renteklimaat, ` +
          `aankomend high-impact event) de richting? Kon de markt het nieuws al hebben ` +
          `ingeprijsd ("sell the news")?\n\n` +

          `④ MOMENTUM-WAARSCHUWING: RSI overbought (>70) voor longs of oversold (<30) voor ` +
          `shorts? MACD-divergentie die een verzwakking signaleert? Momentum dat de trend ` +
          `niet bevestigt?\n\n` +

          `⑤ ENTRY-KWALITEIT: Ontbreekt er een concrete entry-trigger (sweep, reversal, ` +
          `FVG-fill)? Is de entry "te laat" — ver van het sleutelniveau, diep in de beweging? ` +
          `Zou de SL op een logisch technisch niveau staan of te krap?\n\n` +

          `CONCLUSIE: Noem het STERKSTE van de vijf argumenten als je counter-signaal en ` +
          `-zekerheid. Als je na grondig onderzoek in alle vijf categorieën werkelijk ` +
          `niets substantieels vindt, is dat een waardevolle uitkomst: lage counter-zekerheid ` +
          `met vermelding "setup is sterk op alle vijf assen" is méér waard dan een ` +
          `gefabriceerd bezwaar.` +
          `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
          formatCandles(candles),
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
