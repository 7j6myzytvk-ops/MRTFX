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

          `INSTITUTIONELE GOLD-KENNIS (ICT/SMC-framework):\n` +
          `• MARKTSTRUCTUUR: onderscheid BOS (Break of Structure = trendbevestiging) van CHoCH ` +
          `(Change of Character = potentiële trendwisseling). CHoCH is zwaarder dan BOS — alleen ` +
          `bij CHoCH overweeg je een directiewijziging.\n` +
          `• PREMIUM vs DISCOUNT: bereken het equilibrium (50%-punt) van de recente range. Prijs ` +
          `boven equilibrium = premium-zone (instellingen verkopen); onder = discount-zone ` +
          `(instellingen kopen). Geen longentries in premium; geen shortentries in discount.\n` +
          `• LIQUIDITEITSLOGICA: gelijke highs/lows zijn stop-clusters (buy-side boven, sell-side ` +
          `onder). Instellingen "sweepen" die liquidity vóór de echte beweging. Wees sceptisch ` +
          `over breakouts zónder voorafgaande sweep.\n` +
          `• JUDAS SWING (London, 07:00-10:00 UTC): London open maakt vaak een valse doorbraak van ` +
          `de Aziatische range om retail-stops te triggeren, waarna de echte beweging omgekeerd ` +
          `begint. Een London-breakout die NIET vergezeld gaat van sterke momentum-candles is ` +
          `waarschijnlijk een Judas Swing.\n` +
          `• NEW YORK KILL ZONE (12:00-15:00 UTC): de echte institutionele beweging na London ` +
          `manipulatie. NY-open false breaks zijn een klassiek patroon — late London-breakouts ` +
          `die bij NY-open reversal geven zijn sterke setups.\n` +
          `• INDUCEMENT: instellingen creëren soms een "voor de hand liggend" S/R-niveau om ` +
          `retail vroeg in te laten stappen, vóórdat ze die orders gebruiken als liquidity om ` +
          `de echte positie te vullen. Herken dit als prijs te "netjes" weerkeert van een niveau.\n` +
          `• ORDER BLOCKS: de laatste bearish candle vóór een bullish impulse (of vice versa). ` +
          `Breaker Blocks zijn gefaalde order blocks die als omgekeerde S/R fungeren.\n` +
          `• FAIR VALUE GAPS (FVG): drie-candle imbalances die gevuld worden vóór de volgende ` +
          `beweging. Optimale entry: 50%-punt van de FVG.\n` +
          `• RONDE NIVEAUS ($50-intervallen): harde institutionele zones — SL nooit vlak eronder ` +
          `(stop hunt risico), TP niet vlak erboven (weerstand).\n\n` +

          `ANALYSE — doorloop élke stap expliciet:\n` +
          `1. MARKTSTRUCTUUR: BOS of CHoCH? Noem de laatste 2-3 swings met exacte highs/lows. ` +
          `Is er een trend of consolidatie?\n` +
          `2. PREMIUM/DISCOUNT + TRENDBEVESTIGING: Waar staat de prijs t.o.v. het equilibrium? ` +
          `Bevestigen SMA20, SMA50, EMA50, MACD de richting?\n` +
          `3. SLEUTELNIVEAUS: Liquiditeitszones (gelijke H/L), order blocks, FVGs, ronde niveaus. ` +
          `Welke zijn nog onaangetast?\n` +
          `4. SESSIE & MANIPULATIECONTEXT: In welke kill zone zitten we? Heeft London al een Judas ` +
          `Swing gemaakt? Is er recent liquidity gesweept?\n` +
          `5. MOMENTUM: RSI-divergentie? MACD-kruising boven/onder nulsignaal? Bevestigt of ` +
          `contradicteert het momentum de structuur?\n` +
          `6. ENTRY TRIGGER: Is er een CONCRETE aanleiding voor JUIST NU? (sweep+reversal, ` +
          `FVG-fill, OB-test, CHoCH — geen trade zonder trigger én killzone-context)\n` +
          `7. CONCLUSIE: Signaal + zekerheid. Onduidelijk beeld, inducement-risico of verkeerde ` +
          `premium/discount-zone → neutraal of lagere zekerheid.\n\n` +

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
          `Geef je herziene of bevestigde signaal en zekerheid. Reageer SPECIFIEK op de vijf ` +
          `categorieën die de Bear Researcher onderzocht:\n\n` +
          `Voor elke DA-categorie: kun je het bezwaar concreet weerleggen? Of erkent het een ` +
          `zwakte in je analyse? Doe dit beknopt maar inhoudelijk.\n\n` +
          `ZEKERHEIDSREGEL — altijd aanpassen, nooit hetzelfde houden tenzij elk punt weerlegd:\n` +
          `• DA vindt niets steekhoudends in alle vijf categorieën + macro bevestigt jouw ` +
          `richting: VERHOOG zekerheid (dit is een sterk confluence-signaal — alle assen groen)\n` +
          `• DA heeft 1-2 valide punten maar macro steunt jou: kleine aanpassing omhoog of behoud\n` +
          `• DA heeft sterk argument ①②③ (structuur/liquiditeitsval/macro) OF macro contraireert: ` +
          `VERLAAG zekerheid of switch naar neutraal\n` +
          `• DA sterk + macro contra: serieus neutraal overwegen — twee onafhankelijke bronnen ` +
          `wijzen dezelfde waarschuwing\n` +
          `• Specifieke waarschuwing: als de DA een Judas Swing of liquiditeitsval signaleert ` +
          `(categorie ②) die je zelf niet zag, is dat zwaar wegende informatie — verlaag ` +
          `zekerheid significant of ga neutraal.` +
          `${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
