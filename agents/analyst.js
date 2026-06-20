import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { formatCandles } from './formatCandles.js';

const ANALYSIS_TOOL = {
  name: 'leg_analyse_vast',
  description: 'Sla de technische analyse en het handelssignaal vast.',
  input_schema: {
    type: 'object',
    properties: {
      signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      reasoning: { type: 'string', description: 'Korte onderbouwing in het Nederlands (2-3 zinnen).' },
    },
    required: ['signal', 'confidence', 'reasoning'],
  },
};

const REBUTTAL_TOOL = {
  name: 'geef_weerwoord',
  description: 'Sla de bijgestelde of bevestigde analyse na de teamdiscussie vast.',
  input_schema: {
    type: 'object',
    properties: {
      signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      reasoning: {
        type: 'string',
        description: 'Reactie op de discussie: bevestig of herzie je signaal, in het Nederlands (2-3 zinnen).',
      },
    },
    required: ['signal', 'confidence', 'reasoning'],
  },
};

export async function analyzeCandles(
  candles,
  { instrument = 'XAU_USD', granularity = 'H1', events = [], newsContext = '', contextNotes = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const eventsNote = events.length
    ? `\n\nLet op: binnen 48 uur staan de volgende marktbewegende USD-events gepland: ` +
      events.map((e) => `"${e.name}" om ${e.time}`).join(', ') +
      `. Houd hier rekening mee in je zekerheid - een technisch sterk ` +
      `signaal kan binnen enkele uren worden omgekeerd door zo'n event.`
    : '';

  const newsContextNote = newsContext
    ? `\n\nHet team heeft de volgende actuele marktcontext meegegeven (behandel als bevestigd ` +
      `feit, bv. nieuws dat de recente prijsbeweging kan verklaren): "${newsContext}".`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een senior marktstructuur- en liquiditeitsanalist met 15 jaar ervaring in de ` +
          `institutionele goudmarkt. Jouw exclusieve specialiteit: price action structuur en ` +
          `liquiditeitskaarten voor XAU/USD (${granularity}-candles). Je analyseert GEEN indicatoren ` +
          `(RSI/MACD), geen macro-context en geen sessie-timing — die vallen buiten jouw mandaat en ` +
          `worden door gespecialiseerde collega's beoordeeld. Jij beantwoordt één vraag: ` +
          `"Wat zegt de marktstructuur en waar ligt de liquiditeit?"\n\n` +

          `ICT/SMC KENNIS (jouw gereedschapskist):\n` +
          `• MARKTSTRUCTUUR: onderscheid BOS (Break of Structure = trendbevestiging) van CHoCH ` +
          `(Change of Character = potentiële trendwisseling). CHoCH is zwaarder dan BOS.\n` +
          `• HTF → LTF: lees eerst de Weekly/Daily bias, dan H1. Een entry tegen de Daily CHoCH ` +
          `in is structureel onverantwoord — hogere timeframe wint altijd.\n` +
          `• PREMIUM vs DISCOUNT: equilibrium (50%-punt van de recente range). Boven equilibrium ` +
          `= premium (institutions verkopen); onder = discount (institutions kopen). Geen long in ` +
          `premium, geen short in discount — tenzij CHoCH dit invalideer.\n` +
          `• LIQUIDITEITSLOGICA: gelijke highs/lows zijn BSL/SSL-clusters (stop-concentraties). ` +
          `Instellingen sweepen die pools vóór de echte beweging. Breakout zonder sweep = verdacht.\n` +
          `• INDUCEMENT: te "nette" steun/weerstand is vaak een vangst. Herken het als prijs te ` +
          `makkelijk van een niveau weerkeert — retailers stappen in, institutions gebruiken die ` +
          `orders als liquiditeit voor hun echte positie.\n` +
          `• ORDER BLOCKS: laatste bearish candle vóór bullish impulse (of vice versa). ` +
          `Breaker Blocks = gefaalde OBs die als omgekeerde S/R fungeren.\n` +
          `• FAIR VALUE GAPS (FVG): drie-candle imbalances. Optimale entry: 50%-punt van de FVG.\n` +
          `• RONDE NIVEAUS ($50-intervallen): harde institutionele zones.\n\n` +

          `ANALYSE — doorloop élke stap expliciet:\n` +
          `1. HTF BIAS: Wat is de Weekly/Daily trend? Is er een dominante richting of ` +
          `is de hogere structuur onduidelijk/zijwaarts?\n` +
          `2. MARKTSTRUCTUUR (H1): BOS of CHoCH? Noem de laatste 2-3 swings met exacte ` +
          `highs/lows. Trend, consolidatie of trendbreuk?\n` +
          `3. LIQUIDITEITSKAART: Waar liggen de BSL/SSL-clusters (gelijke highs/lows, swing-extremen)? ` +
          `Welk liquiditeitspool is het meest logische volgende institutionele doel?\n` +
          `4. IMBALANCE ZONES: Welke OBs, FVGs en Breaker Blocks zijn nog onaangetast en ` +
          `dichtbij genoeg om als entry-niveau te dienen?\n` +
          `5. CONCLUSIE: Signaal + zekerheid + het concrete prijs-invalidatieniveau (bij welk ` +
          `niveau bewijst de markt dat deze analyse fout is?).\n\n` +

          `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
          `Candles (oudste eerst):\n${formatCandles(candles)}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return { instrument, granularity, ...toolUse.input };
}

export async function reviewDiscussion(
  candles,
  analysis,
  { risk, devilsAdvocate, macro, geopolitical = null },
  { instrument = 'XAU_USD', granularity = 'H1', newsContext = '', contextNotes = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const newsContextNote = newsContext
    ? `\n\nLet op: het team heeft daarnaast de volgende actuele marktcontext meegegeven (behandel ` +
      `als bevestigd feit): "${newsContext}".`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [REBUTTAL_TOOL],
    tool_choice: { type: 'tool', name: REBUTTAL_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent de technisch analist voor ${instrument} (${granularity}-candles). ` +
          `Je gaf eerder het signaal "${analysis.signal}" (zekerheid ${analysis.confidence}%) ` +
          `met de onderbouwing: "${analysis.reasoning}". ` +
          `Je collega's reageerden hierop:\n\n` +
          `Risicomanager (SL ${risk.stopLoss}, TP ${risk.takeProfit}, positiegrootte "${risk.positionSize}"): ` +
          `${risk.reasoning}\n\n` +
          `Devil's Advocate (tegen-signaal "${devilsAdvocate.counterSignal}", zekerheid ${devilsAdvocate.counterConfidence}%): ` +
          `${devilsAdvocate.argument}\n\n` +
          `Marktcontext/Sentiment ("${macro.sentiment}", zekerheid ${macro.confidence}%): ${macro.reasoning}\n\n` +
          (geopolitical && geopolitical.confidence > 0
            ? `Geopolitieke/nieuws-analist ("${geopolitical.assessment}", zekerheid ${geopolitical.confidence}%): ` +
              `${geopolitical.reasoning}\n\n`
            : '') +
          `Geef je herziene of bevestigde signaal en zekerheid. Reageer als marktstructuur-specialist ` +
          `op wat het team heeft ingebracht:\n\n` +
          `PRIMAIRE TAAK — reageer op het pre-mortem scenario van de Bear Researcher:\n` +
          `• Faalscenario ① (HTF-structuur fout): Is er inderdaad een hogere CHoCH die je hebt ` +
          `gemist? Of klopt de Daily/Weekly bias nog steeds?\n` +
          `• Faalscenario ② (Institutionele val): Staan we inderdaad in een stop-cluster of ` +
          `inducement-zone? Of is de entry structureel verantwoord?\n` +
          `• Faalscenario ③ (Timing mismatch): Heeft de macro-analist of geo-analist informatie ` +
          `gegeven die de timing van je entry in twijfel trekt?\n` +
          `• Faalscenario ④ (Zone al verwerkt): Is het OB of de FVG die je als entry zag al ` +
          `eerder bezocht en daarmee verbruikt?\n` +
          `• Faalscenario ⑤ (Genegeerd bewijs): Zijn er structurele signalen die je eerder ` +
          `wegrationaliseerde maar die nu, na de discussie, zwaarder wegen?\n\n` +
          `ZEKERHEIDSREGEL:\n` +
          `• Pre-mortem vindt geen overtuigend faalscenario + macro bevestigt: VERHOOG zekerheid\n` +
          `• Pre-mortem heeft 1 steekhoudend punt: kleine aanpassing omlaag of behoud\n` +
          `• Pre-mortem scenario ① of ② bevestigd (HTF-structuur of institutionele val): ` +
          `VERLAAG significant of switch naar neutraal\n` +
          `• Meerdere faalscenario's bevestigd: neutraal — de structurele basis is onzeker.` +
          `${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
