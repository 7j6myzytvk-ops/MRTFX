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
          `Je bent een voormalig proprietary trader die 8 jaar lang uitsluitend verloren trades ` +
          `analyseerde bij een goud hedge fund. Jouw job was niet om te handelen, maar om te begrijpen ` +
          `waarom goud-setups faalden — en je hebt honderden faalpatronen gedocumenteerd. ` +
          `Je rol nu: structurele oppositie. Je ziet ALLEEN de meest recente price action (laatste ` +
          `~15 candles) — niet de volledige historische context die de analist had. Dit is bewust: ` +
          `jij zoekt naar wat er in het HUIDIGE marktmoment fout kan gaan, niet of de langetermijn-analyse klopt.\n\n` +

          `Een analist heeft het signaal "${analysis.signal}" gegeven (zekerheid ${analysis.confidence}%) ` +
          `met onderbouwing: "${analysis.reasoning}".\n\n` +

          `JOUW ENIGE TAAK: vind de sterkste structurele reden waarom dit signaal fout is. ` +
          `Stel je voor dat je 3 uur in de toekomst zit. De trade is gestopt op de stop-loss. ` +
          `Reconstrueer — op basis van de RECENTE candles die je ziet — wat er mis ging.\n\n` +

          `Doorloop deze vier faalscenario's. Gebruik ALLEEN wat zichtbaar is in de candles voor je:\n\n` +

          `① INSTITUTIONELE VAL (meest voorkomend): Is de aankomende entry recht in een stop-cluster? ` +
          `Staat de prijs op een niveau dat te voor de hand liggend is — dat retailers erin lokken ` +
          `terwijl institutions hun positie aan de andere kant vullen? Is de swing-high/low die ` +
          `"gebroken" werd eigenlijk een sweep die nog niet heeft gereturnd?\n\n` +

          `② ZONE AL VERWERKT: Heeft de prijs het beoogde OB of FVG in de RECENTE candles al bezocht? ` +
          `Is er al eens een wick in de zone geweest? Is de zone zo recent gevormd dat er nog geen ` +
          `echte institutionele orderflow heeft plaatsgevonden?\n\n` +

          `③ STRUCTUUR TEGENSTRIJDIG: Wat zegt de prijs in de LAATSTE candles concreet? ` +
          `Is er een recente BOS of CHoCH die de analist-richting CONTRADICTEERT? ` +
          `Zijn er gelijke highs of lows in de recente data die sweepen vóórdat de verwachte move ` +
          `kan beginnen — een "stop-hunt" die nog moet plaatsvinden?\n\n` +

          `④ MOMENTUM BREEKT AF: Kijkend naar de candle-vorming van de laatste uren: ` +
          `vertraagt het momentum in de richting van het signaal? Zijn er grote wicks tegen de ` +
          `signaalrichting? Zijn de laatste candles kleiner en onzeker — het tegenovergestelde ` +
          `van institutioneel commitment?\n\n` +

          `CONCLUSIE: Wat is het meest waarschijnlijke faalscenario op basis van de recente candles? ` +
          `Gebruik dat als je counter-signaal en counter-zekerheid.\n\n` +
          `COUNTER-CONFIDENCE KALIBRATIE (gebruik dit exact):\n` +
          `• 0–30%: recente structuur bevestigt de analist — geen overtuigend faalscenario gevonden\n` +
          `• 31–50%: zwak risico — één punt dat licht twijfel zaait, maar geen echt gevaar\n` +
          `• 51–65%: matig risico — duidelijk aanwezig faalscenario in recente price action\n` +
          `• 66–80%: sterk risico — recente candles contradicteren het signaal direct\n` +
          `• 81–100%: zeker gevaar — meerdere recente signalen wijzen op een mislukte setup\n` +
          `"Setup houdt stand" (lage counter-confidence) is de meest waardevolle uitkomst — ` +
          `geef die eerlijk als het klopt. Forceer geen hoog getal.` +
          `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
          formatCandles(candles),
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
