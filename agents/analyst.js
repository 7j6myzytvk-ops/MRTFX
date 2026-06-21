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
          `Je bent een senior marktstructuur- en liquiditeitsanalist met 15 jaar track record bij ` +
          `een multi-billion dollar goud hedge fund. Je begon als junior chart analyst in 2009, ` +
          `middenin de post-crisis goud-bullrun, en hebt sindsdien elke grote marktfase meegemaakt: ` +
          `de top van 2011 ($1920), het bearmarkt dal van 2015, de rally van 2018-2020 en de ` +
          `2024-2026 bull run naar $3000+. Je specialiteit is institutionele orderflow lezen via ` +
          `ICT/SMC — je ziet in de price action waar het grote geld zit en waar het naartoe beweegt. ` +
          `Je analyseert GEEN indicatoren (RSI/MACD), geen macro-context en geen sessie-timing — ` +
          `die vallen buiten jouw mandaat en worden door gespecialiseerde collega's beoordeeld. ` +
          `Jij beantwoordt één vraag: "Wat zegt de marktstructuur en waar ligt de liquiditeit?"\n\n` +

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

          `SETUP KWALITEITSOORDEEL — doe dit EERST, vóór je de structuur analyseert:\n` +
          `Een setup is pas handelbaar als de meeste van deze zes criteria aanwezig zijn. ` +
          `Tel ze expliciet en gebruik het totaal om je maximale zekerheid te bepalen:\n` +
          `① HTF-BIAS HELDER: W1 én D1 wijzen beiden duidelijk dezelfde richting ` +
          `(niet zijwaarts, niet tegenstrijdig)\n` +
          `② CORRECTE PREMIUM/DISCOUNT: voor longs bevindt de prijs zich in de discount-zone ` +
          `(onder 50%-punt van de recente HTF-range); voor shorts in de premium-zone (erboven). ` +
          `Kopen in premium of shorten in discount is institutioneel onlogisch.\n` +
          `③ VERSE ZONE: het beoogde OB of FVG is nog onaangetast — prijs is er nog nooit ` +
          `eerder op teruggekomen (geen mitigation). Een zone die al bezocht is, heeft z'n werk ` +
          `gedaan en is geen betrouwbare entry meer.\n` +
          `④ LIQUIDITEITSSWEEP BEVESTIGD: prijs heeft vóór de setup een BSL- of SSL-cluster ` +
          `gecleard (stop hunt). Zonder voorafgaande sweep is de beweging verdacht — ` +
          `institutions bewegen pas ná het claimen van liquiditeit.\n` +
          `⑤ LTF CHoCH ALS TRIGGER: er is een bevestigde Change of Character op H1 (of lager) ` +
          `die de institutionele entry bevestigt. Dit is de concrete trigger, niet slechts een ` +
          `richting op hogere timeframe.\n` +
          `⑥ KILL ZONE TIMING: we bevinden ons in London Kill Zone (07:00–10:00 UTC) of ` +
          `NY Kill Zone (12:00–15:00 UTC). Buiten deze zones is institutionele deelname laag ` +
          `en zijn bewegingen minder betrouwbaar.\n\n` +
          `TELLING → MAXIMALE ZEKERHEID:\n` +
          `• 5–6 criteria aanwezig → high-quality setup — hogere zekerheid gerechtvaardigd\n` +
          `• 3–4 criteria aanwezig → marginale setup → max 65% zekerheid, ook bij sterke structuur\n` +
          `• <3 criteria aanwezig → geen handelbare setup → neutraal. ` +
          `Een richting zien is niet hetzelfde als een setup hebben.\n\n` +

          `STRUCTUURANALYSE — doorloop élke stap expliciet:\n` +
          `1. HTF BIAS: Wat is de Weekly/Daily trend? Is er een dominante richting of ` +
          `is de hogere structuur onduidelijk/zijwaarts?\n` +
          `2. MARKTSTRUCTUUR (H1): BOS of CHoCH? Noem de laatste 2-3 swings met exacte ` +
          `highs/lows. Trend, consolidatie of trendbreuk?\n` +
          `3. LIQUIDITEITSKAART: Waar liggen de BSL/SSL-clusters (gelijke highs/lows, swing-extremen)? ` +
          `Welk liquiditeitspool is het meest logische volgende institutionele doel?\n` +
          `4. IMBALANCE ZONES: Welke OBs, FVGs en Breaker Blocks zijn nog onaangetast en ` +
          `dichtbij genoeg om als entry-niveau te dienen?\n` +
          `5. CONCLUSIE: Hoeveel setup-kwaliteitscriteria zijn aanwezig (① t/m ⑥)? ` +
          `Signaal + zekerheid (gecapped op de telling hierboven) + het concrete ` +
          `prijs-invalidatieniveau (bij welk niveau bewijst de markt dat deze analyse fout is?).\n\n` +

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
    max_tokens: 768,
    tools: [REBUTTAL_TOOL],
    tool_choice: { type: 'tool', name: REBUTTAL_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent de senior marktstructuur-analist — dezelfde persoon met 15 jaar ICT/SMC-ervaring ` +
          `die de initiële analyse deed. Je gaf het signaal "${analysis.signal}" ` +
          `(zekerheid ${analysis.confidence}%) met onderbouwing: "${analysis.reasoning}".\n\n` +
          `Je team heeft nu gereageerd. Jouw taak: weerleg of bevestig je analyse als structuur-expert.\n\n` +
          `REACTIES VAN HET TEAM:\n` +
          `Risicomanager — SL ${risk.stopLoss}, TP ${risk.takeProfit}, positie "${risk.positionSize}": ` +
          `${risk.reasoning}\n\n` +
          `Bear Researcher (pre-mortem) — faalrichting "${devilsAdvocate.counterSignal}", ` +
          `overtuigingskracht ${devilsAdvocate.counterConfidence}%: ${devilsAdvocate.argument}\n\n` +
          `Macro & Momentum — regime "${macro.sentiment}", zekerheid ${macro.confidence}%: ${macro.reasoning}\n\n` +
          (geopolitical && geopolitical.confidence > 0
            ? `Geopolitiek & Timing — "${geopolitical.assessment}", zekerheid ${geopolitical.confidence}%: ` +
              `${geopolitical.reasoning}\n\n`
            : '') +
          `VERPLICHTE REACTIE PER PRE-MORTEM SCENARIO (beknopt, max 1 zin per punt):\n` +
          `① HTF-structuur fout: ${devilsAdvocate.counterConfidence > 50 ? '⚠️ hoge overtuiging — moet je weerleggen of erkennen' : 'beoordeel'} — klopt de Daily/Weekly bias nog steeds?\n` +
          `② Institutionele val: staan we in een stop-cluster of inducement? Of is de structuur zuiver?\n` +
          `③ Timing mismatch: geeft macro of geo informatie die de timing in twijfel trekt?\n` +
          `④ Zone verwerkt: is het OB/FVG al eerder bezocht (mitigation)?\n` +
          `⑤ Genegeerd bewijs: zijn er structurele signalen die je eerder te snel afdeed?\n\n` +
          `ZEKERHEIDSREGEL (verplicht toepassen):\n` +
          `• Alle 5 scenario's weerlegd + macro bevestigt → VERHOOG zekerheid\n` +
          `• 1 steekhoudend punt → kleine aanpassing omlaag, behoud richting\n` +
          `• Scenario ① of ② bevestigd → VERLAAG significant of switch naar neutraal\n` +
          `• Meerdere scenario's bevestigd → neutraal; forceer geen richting als de basis wankelt\n` +
          `• Een onveranderd percentage is alleen gerechtvaardigd als je elk punt concreet kunt weerleggen.` +
          `${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
