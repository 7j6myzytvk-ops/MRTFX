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
          `Je bent een pre-mortem specialist voor institutionele goudhandel ` +
          `(${instrument}, ${granularity}-candles). Jouw methodologie: prospectief faalonderzoek.\n\n` +

          `Een analist heeft het signaal "${analysis.signal}" gegeven (zekerheid ${analysis.confidence}%) ` +
          `met onderbouwing: "${analysis.reasoning}".\n\n` +

          `JOUW MANDAAT — GEEN tegengesteld signaal zoeken. WEL: stel je voor dat je 3 uur in de ` +
          `toekomst zit. De trade is gestopt op de stop-loss. Reconstrueer wat er mis ging.\n\n` +

          `Doorloop systematisch deze vijf faalscenario's. Bij elk: is dit scenario waarschijnlijk ` +
          `gegeven de huidige data?\n\n` +

          `① HTF-STRUCTUUR FOUT: Had de Weekly of Daily trend al gedraaid (CHoCH op hogere timeframe) ` +
          `vóórdat het team inging? Is er een significant swing level dat intact was maar als ` +
          `'gepasseerd' werd beschouwd? Beschrijf wat de hogere structuur concreet zegt.\n\n` +

          `② INSTITUTIONELE VAL: Was dit een te voor de hand liggende setup — zagen teveel retailers ` +
          `precies hetzelfde? Staat de entry direct boven gelijke highs of onder gelijke lows ` +
          `(recht in een stop-cluster)? Liepen we in een liquidity sweep die institutions ` +
          `orkestreerden om hun positie aan de andere kant te vullen? Is de entry in een ` +
          `premium-zone (voor longs) of discount-zone (voor shorts)?\n\n` +

          `③ TIMING MISMATCH: Stapten we in tijdens de verkeerde fase? London manipulatiefase ` +
          `(07:00-10:00 UTC) zonder bevestiging dat de Judas Swing al afgerond was? Of in de ` +
          `rustige Asian sessie (00:00-07:00 UTC) waar movements misleidend zijn? Stond er een ` +
          `hoog-impact event op de agenda dat de setup kon omverwerpen?\n\n` +

          `④ ZONE AL VERWERKT: Waren het OB of de FVG die als entry dienden al eerder bezocht? ` +
          `Had price er al doorheen bewogen (de zone had al als "mitigation" gefunctioneerd) ` +
          `en hadden we dat niet opgemerkt?\n\n` +

          `⑤ GENEGEERD BEWIJS: Welk signaal was er in de data maar werd gerationaliseerd? ` +
          `RSI/MACD-divergentie die de richting contradicteert? Een nieuwsitem dat macro-tegenwind ` +
          `suggereerde? Een argument dat in de initiële analyse te snel werd afgedaan?\n\n` +

          `CONCLUSIE: Wat is het meest waarschijnlijke faalscenario? Gebruik dat als je ` +
          `counter-signaal en counter-zekerheid. Als je na grondig onderzoek echt geen overtuigend ` +
          `faalscenario vindt: meld dat expliciet met lage counter-zekerheid — ` +
          `"setup houdt stand tegen pre-mortem" is de waardevolste uitkomst die er is.` +
          `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
          formatCandles(candles),
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
