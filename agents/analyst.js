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
          `Je bent een senior technisch analist met 15 jaar ervaring in de institutionele goudmarkt. ` +
          `Je specialiteit is XAU/USD price action op intraday timeframes (${granularity}), met diepgaande ` +
          `kennis van hoe institutionele spelers (centrale banken, hedgefondsen, bullionbanken) de markt bewegen.\n\n` +

          `GOLD-SPECIFIEKE KENNIS die je toepast:\n` +
          `• Ronde niveaus ($50-intervallen) zijn harde S/R-zones — institutionele orders clusteren hier\n` +
          `• Gelijke highs/lows zijn liquiditeitszones: ze worden doorgaans "gesweept" (stop hunt) ` +
          `vóórdat de echte beweging start — wees sceptisch over breakouts zonder voorafgaande sweep\n` +
          `• Order Blocks: de laatste bearish candle vóór een bullish impulse (of vice versa) markeert ` +
          `institutionele interesse — deze zones worden vaak opnieuw getest als entry\n` +
          `• Fair Value Gaps (FVG): imbalances in price action hebben de neiging gevuld te worden ` +
          `vóór de volgende grote beweging\n` +
          `• London Fix (10:30 UTC) is een sleutelmoment voor institutionele prijszetting — kan ` +
          `scherpe wendingen veroorzaken\n` +
          `• New York-open (13:00–15:00 UTC) geeft regelmatig een false break van de London-range ` +
          `gevolgd door reversal — late London-breakouts zijn riskanter\n\n` +

          `ANALYSE — doorloop élke stap expliciet:\n` +
          `1. MARKTSTRUCTUUR: Uptrend (HH/HL), downtrend (LH/LL) of consolidatie? Noem de laatste 2-3 swings.\n` +
          `2. TRENDBEVESTIGING: Bevestigen SMA20, SMA50, EMA50, MACD de structuur?\n` +
          `3. SLEUTELNIVEAUS: Welke swing highs/lows, liquiditeitszones, order blocks of ronde ` +
          `niveaus zijn relevant?\n` +
          `4. MOMENTUM: RSI-divergentie? MACD-kruising? Bevestigt of contradicteert het momentum ` +
          `de trend?\n` +
          `5. ENTRY TRIGGER: Is er een concrete aanleiding voor JUIST NU? (bounce, break+retest, ` +
          `FVG-fill, sweep+reversal — geen trade zonder trigger)\n` +
          `6. CONCLUSIE: Signaal + zekerheid. Onduidelijk beeld → lagere zekerheid of neutraal.\n\n` +

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
          `Geef je herziene of bevestigde signaal en zekerheid, met een korte reactie op de discussie. ` +
          `Weeg elk argument inhoudelijk en pas je zekerheidspercentage ALTIJD aan — ook als je bij ` +
          `je richting blijft. Een onveranderd percentage is alleen gerechtvaardigd als je elk argument ` +
          `concreet kunt weerleggen.\n\n` +
          `Cruciale vuistregel op basis van teamconsensus:\n` +
          `- Als de Devil's Advocate géén sterk tegenargument vond EN het macro-oordeel jouw richting ` +
          `bevestigt: VERHOOG je zekerheid duidelijk (dit is een sterk confluentsignaal).\n` +
          `- Als het macro-oordeel jouw richting bevestigt maar de DA een steekhoudend punt maakt: ` +
          `kleine aanpassing omhoog of behoud.\n` +
          `- Als het macro contraireert OF de DA een sterk tegenargument geeft: VERLAAG je zekerheid ` +
          `of switch naar neutraal.\n` +
          `- Als zowel DA als macro tegen jou zijn: overweeg serieus om naar neutraal te gaan.` +
          `${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
