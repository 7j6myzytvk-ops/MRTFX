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
      setupQualityScore: {
        type: 'integer',
        minimum: 0,
        maximum: 6,
        description: 'Aantal aanwezige setup-kwaliteitscriteria. Reversal-modus: 0-6 (① t/m ⑥). Trend-modus: 0-4 (① t/m ④). Bepaalt maximale zekerheid en of de setup handelbaar is.',
      },
      amdPhase: {
        type: 'string',
        enum: ['accumulation', 'manipulation', 'distribution', 'onduidelijk'],
        description: 'AMD-fase van de huidige sessie: accumulation (range/consolidatie), manipulation (Judas Swing bezig of onduidelijk), distribution (echte institutionele move — manipulatie aantoonbaar afgerond), onduidelijk.',
      },
      reasoning: { type: 'string', description: 'Korte onderbouwing in het Nederlands (2-3 zinnen). Noem welke criteria aanwezig/afwezig zijn.' },
    },
    required: ['signal', 'confidence', 'setupQualityScore', 'amdPhase', 'reasoning'],
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
  { instrument = 'XAU_USD', granularity = 'H1', events = [], newsContext = '', contextNotes = '', trendMode = false } = {},
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

  const promptContent = trendMode
    ? buildTrendModePrompt({ eventsNote, newsContextNote, contextNotes, candles })
    : buildReversalModePrompt({ eventsNote, newsContextNote, contextNotes, candles });

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
    messages: [{ role: 'user', content: promptContent }],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return { instrument, granularity, ...toolUse.input };
}

function buildTrendModePrompt({ eventsNote, newsContextNote, contextNotes, candles }) {
  return (
    `Je bent een senior trend-analist gespecialiseerd in trend-continuatie setups op XAU/USD. ` +
    `Je begon je carrière als futures-trader op de CME in Chicago, waar je 8 jaar uitsluitend ` +
    `handelde in momentum en trend-following op edelmetalen. In de pits leerde je één les die ` +
    `alles overstijgt: de beste trades zijn de eenvoudigste — trend identificeren, pullback ` +
    `afwachten, en instappen zodra de beweging hervat. Na Chicago werkte je 10 jaar als ` +
    `hoofd trend-strategie bij een CTA-fonds (Commodity Trading Advisor) gespecialiseerd in ` +
    `hard assets. Je hebt nooit geleerd om reversals te handelen — dat is bewust. ` +
    `Je analyseert GEEN sweep/OB/CHoCH en GEEN ichimoku/RSI — die vallen buiten jouw mandaat. ` +
    `Jij beantwoordt één vraag: "Is er een pullback geweest in de trend, en wil de prijs nu verder?"\n\n` +

    `🔵 TREND-MODUS: 4H + D1 + H1 + M30 zijn allen aligned in dezelfde richting. ` +
    `Dit is GEEN reversal-analyse. Je zoekt GEEN sweep, OB of CHoCH als trigger — ` +
    `die zijn alleen vereist bij reversals. Hier zoek je naar pullback-herstel binnen een lopende trend.\n\n` +

    `TREND-SETUP KWALITEITSCRITERIA — tel ze expliciet (① t/m ④):\n` +
    `① 4H-TREND HELDER: de 4H-candles tonen consistent hogere highs+lows (bullish) of ` +
    `lagere highs+lows (bearish). Niet zijwaarts, niet tegenstrijdig. ` +
    `Minimaal 3 van de laatste 5 4H-candles sluiten in de trendrichting.\n` +
    `② PULLBACK AANWEZIG EN AFGEROND: op de H1-candles zijn 2+ opeenvolgende ` +
    `correctie-candles zichtbaar (tegen de trend in). De pullback is AFGEROND: ` +
    `prijs bewoog al terug in de trendrichting. Scoort NIET als prijs nog midden in de ` +
    `correctie zit zonder herstel. ` +
    `Scoort NIET als de correctie >50% van de vorige trending-swing is (te diep = mogelijk trendbreuk).\n` +
    `③ LOGISCHE STOP: er is een duidelijke swing low (bij bullish) of swing high (bij bearish) ` +
    `beschikbaar als stop-loss. Concreet beslismoment: ` +
    `de afstand van de huidige prijs tot dat swing punt is $20–$80. ` +
    `Scoort NIET als er geen identificeerbaar swing punt is, of als de stop <$15 of >$100 is.\n` +
    `④ R:R ≥ 1:1: het volgende logische weerstandsniveau (bij bullish: swing high, ronde waarde ` +
    `op $50-interval, supply zone; bij bearish: swing low, ronde waarde, demand zone) ` +
    `levert als take-profit minstens 1:1 risk:reward op ten opzichte van criterium ③.\n\n` +

    `TELLING → MAXIMALE ZEKERHEID:\n` +
    `• 4/4 criteria → sterke trend-setup → max 78% zekerheid\n` +
    `• 3/4 criteria → matige trend-setup → max 68% zekerheid\n` +
    `• ≤2/4 criteria → GEEN handelbare setup → verplicht NEUTRAAL\n` +
    `Een trend zien is niet hetzelfde als een setup hebben.\n\n` +

    `STRUCTUURANALYSE — doorloop élke stap expliciet:\n` +
    `1. 4H-TREND VERIFICATIE: Bekijk de 4H-STRUCTUUR context. Zijn de laatste 3-5 4H-candles ` +
    `consistent bullish (hogere highs+lows) of bearish (lagere highs+lows)? ` +
    `Is er twijfel over de trendrichting?\n` +
    `2. PULLBACK-KWALITEIT: Zijn er 2+ aaneengesloten H1-correctie-candles zichtbaar? ` +
    `Heeft de correctie gestopt bij een logisch niveau (OB, FVG, ronde waarde, SMA)? ` +
    `Beweegt prijs al terug in de trendrichting? Is de correctie <50% van de vorige swing?\n` +
    `3. STOP-ANALYSE: Wat is het dichtstbijzijnde significante swing low/high? ` +
    `Afstand van de laatste close? Is dit een echt technisch niveau?\n` +
    `4. DOELSTELLING: Wat is het volgende logische TP-niveau? Bereken R:R op basis van ` +
    `de stop uit stap 3. Zijn er weerstandszones tussen entry en TP die de trade kunnen blokkeren?\n` +
    `4b. AMD-FASE: In welke fase zit de sessie? (accumulation/manipulation/distribution/onduidelijk)\n` +
    `5. CONCLUSIE: Hoeveel trend-criteria aanwezig (①–④)? Signaal + zekerheid gecapped op de telling.\n\n` +

    `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
    `Candles (oudste eerst):\n${formatCandles(candles)}`
  );
}

function buildReversalModePrompt({ eventsNote, newsContextNote, contextNotes, candles }) {
  return (
    `Je bent een senior marktstructuur- en liquiditeitsanalist met 15 jaar track record bij ` +
    `een multi-billion dollar goud hedge fund. Je begon als junior chart analyst in 2009, ` +
    `middenin de post-crisis goud-bullrun, en hebt sindsdien elke grote marktfase meegemaakt: ` +
    `de top van 2011 ($1920), het bearmarkt dal van 2015, de rally van 2018-2020 en de ` +
    `2024-2026 bull run naar $3000+. Je specialiteit is institutionele orderflow lezen via ` +
    `ICT/SMC — je ziet in de price action waar het grote geld zit en waar het naartoe beweegt. ` +
    `Je analyseert GEEN indicatoren (RSI/MACD) en geen macro-context — die vallen buiten ` +
    `jouw mandaat en worden door gespecialiseerde collega's beoordeeld. ` +
    `Jij beantwoordt één vraag: "Wat zegt de marktstructuur, en is dit een handelbare setup?"\n\n` +

    `ICT/SMC KENNIS (jouw gereedschapskist):\n` +
    `• MARKTSTRUCTUUR: onderscheid BOS (Break of Structure = trendbevestiging) van CHoCH ` +
    `(Change of Character = potentiële trendwisseling). CHoCH is zwaarder dan BOS.\n` +
    `• HTF → LTF: lees eerst de 4H/Daily bias, dan H1. Een entry tegen de 4H CHoCH ` +
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
    `① HTF-BIAS HELDER: 4H én D1 wijzen beiden duidelijk dezelfde richting ` +
    `(niet zijwaarts, niet tegenstrijdig). Gebruik de 4H-STRUCTUUR context hierboven om ` +
    `de 4H-bias te bepalen. W1 is macro-achtergrond, niet het richting-criterium.\n` +
    `② CORRECTE PREMIUM/DISCOUNT: voor longs bevindt de prijs zich in de discount-zone ` +
    `(onder 50%-punt van de recente 4H/D1-range); voor shorts in de premium-zone (erboven). ` +
    `Kopen in premium of shorten in discount is institutioneel onlogisch.\n` +
    `③ VERSE ZONE: het beoogde OB of FVG is nog onaangetast. Concreet beslismoment:\n` +
    `  – VERS (ken ③ toe): geen enkele H1-candle heeft gesloten BINNEN of VOORBIJ de zone; ` +
    `prijs is er niet naartoe teruggekeerd; de zone is ≤ 50 H1-candles geleden gecreëerd.\n` +
    `  – GEMITIGEERD (ken ③ NIET toe): (a) een candle sloot voor meer dan 50% van de zone; ` +
    `(b) prijs doorsneed de zone volledig (body sloot voorbij de zone); ` +
    `(c) de zone is ouder dan 50 candles. Dit zijn harde grenzen — geen uitzonderingen.\n` +
    `④ LIQUIDITEITSSWEEP BEVESTIGD: prijs heeft vóór de huidige setup een BSL- of ` +
    `SSL-cluster gecleard. Concreet beslismoment:\n` +
    `  – BULLISH sweep: een recente swing low of gelijke lows zijn gebroken met een wick ` +
    `(close terug erboven) — bij voorkeur binnen de laatste 25 H1-candles.\n` +
    `  – BEARISH sweep: een recente swing high of gelijke highs gebroken met wick ` +
    `(close terug eronder) — bij voorkeur binnen de laatste 25 H1-candles.\n` +
    `  – Wees eerlijk: ken ④ toe als er een herkenbare sweep-actie heeft plaatsgevonden, ` +
    `ook als de CHoCH-opvolging nog pril is. Ontbreekt elke sweep-beweging volledig? Dan ④ niet toekennen.\n` +
    `⑤ LTF CHoCH ALS TRIGGER: er is een bevestigde Change of Character op H1 (of lager).\n` +
    `  DEFINITIE — CHoCH vs BOS:\n` +
    `  – CHoCH bearish (ken ⑤ toe): na een bullish structuur (reeks hogere highs/lows) sluit ` +
    `een H1-candle ONDER het laatste relevante swing low. Trendwisseling bevestigd.\n` +
    `  – CHoCH bullish (ken ⑤ toe): na een bearish structuur (reeks lagere highs/lows) sluit ` +
    `een H1-candle BOVEN het laatste relevante swing high. Trendwisseling bevestigd.\n` +
    `  – BOS (ken ⑤ NIET toe): breuk in dezélfde richting als de lopende trend — dit is ` +
    `trendbevestiging, geen trigger voor een reversal-entry.\n` +
    `  – HARDE REGEL: alleen een gesloten candle geldt. Wick voorbij het swing level zonder ` +
    `slotkoers = geen CHoCH. Ontbreekt een duidelijke CHoCH? Wijs ⑤ NIET toe.\n` +
    `⑥ KILL ZONE TIMING: beoordeel op basis van de sessie-context (zie SESSION-noot hieronder) ` +
    `in welke handelsperiode de setup valt:\n` +
    `  – NY Kill Zone (13:00–17:00 UTC): hoogste institutionele liquiditeit — sterkste window. Ken ⑥ toe.\n` +
    `  – London Kill Zone (07:00–10:00 UTC): manipulatie → distributie-fase. Ken ⑥ toe.\n` +
    `  – London-NY overlap / rustige uren (10:00–13:00 UTC): lagere institutionele activiteit. ⑥ NIET toekennen.\n` +
    `  – Buiten sessie (vóór 07:00 of na 17:00 UTC): ⑥ NIET toekennen.\n\n` +
    `TELLING → MAXIMALE ZEKERHEID:\n` +
    `• 4–6 criteria aanwezig → high-quality setup — hogere zekerheid gerechtvaardigd\n` +
    `• 3 criteria aanwezig → solide setup → max 72% zekerheid\n` +
    `• 2 criteria aanwezig → marginale setup → max 60% zekerheid\n` +
    `• <2 criteria aanwezig → geen handelbare setup → neutraal. ` +
    `Een richting zien is niet hetzelfde als een setup hebben.\n\n` +

    `STRUCTUURANALYSE — doorloop élke stap expliciet:\n` +
    `1. HTF BIAS: Wat is de 4H/Daily trend? Is er een dominante richting of ` +
    `is de hogere structuur onduidelijk/zijwaarts? Gebruik de 4H-STRUCTUUR context hierboven.\n` +
    `2. MARKTSTRUCTUUR (H1): BOS of CHoCH? Noem de laatste 2-3 swings met exacte ` +
    `highs/lows. Trend, consolidatie of trendbreuk?\n` +
    `3. LIQUIDITEITSKAART: Waar liggen de BSL/SSL-clusters (gelijke highs/lows, swing-extremen)? ` +
    `Welk liquiditeitspool is het meest logische volgende institutionele doel?\n` +
    `4. IMBALANCE ZONES: Welke OBs, FVGs en Breaker Blocks zijn nog onaangetast en ` +
    `dichtbij genoeg om als entry-niveau te dienen?\n` +
    `4b. AMD-FASE (Power of Three): In welke fase zit de huidige sessie?\n` +
    `• Accumulation (A): range-vorming, liquiditeit wordt verzameld aan beide kanten\n` +
    `• Manipulation (M): Judas Swing — valse breakout om stops te triggeren. ` +
    `IS DEZE FASE AANTOONBAAR AFGEROND (sweep bevestigd + CHoCH)?\n` +
    `• Distribution (D): echte institutionele move — alleen handelbaar ná afgeronde M-fase\n` +
    `Als M niet aantoonbaar afgerond is: verlaag je zekerheid of ga naar neutraal.\n` +
    `5. CONCLUSIE: Hoeveel setup-kwaliteitscriteria zijn aanwezig (① t/m ⑥)? ` +
    `Signaal + zekerheid (gecapped op de telling hierboven) + het concrete ` +
    `prijs-invalidatieniveau (bij welk niveau bewijst de markt dat deze analyse fout is?).\n\n` +

    `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
    `Candles (oudste eerst):\n${formatCandles(candles)}`
  );
}

export async function reviewDiscussion(
  candles,
  analysis,
  { risk, devilsAdvocate, macro, geopolitical = null },
  { instrument = 'XAU_USD', granularity = 'H1', newsContext = '', contextNotes = '', trendMode = false } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const newsContextNote = newsContext
    ? `\n\nLet op: het team heeft daarnaast de volgende actuele marktcontext meegegeven (behandel ` +
      `als bevestigd feit): "${newsContext}".`
    : '';

  const rebuttalContent = trendMode
    ? buildTrendModeRebuttal({ analysis, risk, devilsAdvocate, macro, geopolitical, newsContextNote, contextNotes })
    : buildReversalModeRebuttal({ analysis, risk, devilsAdvocate, macro, geopolitical, newsContextNote, contextNotes });

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 768,
    tools: [REBUTTAL_TOOL],
    tool_choice: { type: 'tool', name: REBUTTAL_TOOL.name },
    messages: [{ role: 'user', content: rebuttalContent }],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}

function buildTrendModeRebuttal({ analysis, risk, devilsAdvocate, macro, geopolitical, newsContextNote, contextNotes }) {
  return (
    `Je bent de senior trend-analist — dezelfde persoon die de trend-setup analyseerde. ` +
    `Je gaf het signaal "${analysis.signal}" (zekerheid ${analysis.confidence}%) ` +
    `met onderbouwing: "${analysis.reasoning}".\n\n` +
    `Je team heeft gereageerd. Jouw taak: weerleg of bevestig je analyse als trend-expert.\n\n` +

    `REACTIES VAN HET TEAM:\n` +
    `Risicomanager — SL ${risk.stopLoss}, TP ${risk.takeProfit}, positie "${risk.positionSize}": ` +
    `${risk.reasoning}\n\n` +
    `Pre-mortem specialist — faalrichting "${devilsAdvocate.counterSignal}", ` +
    `overtuigingskracht ${devilsAdvocate.counterConfidence}%: ${devilsAdvocate.argument}\n\n` +
    `Macro & Momentum — regime "${macro.sentiment}", zekerheid ${macro.confidence}%: ${macro.reasoning}\n\n` +
    (geopolitical && geopolitical.confidence > 0
      ? `Geopolitiek & Timing — "${geopolitical.assessment}", zekerheid ${geopolitical.confidence}%: ` +
        `${geopolitical.reasoning}\n\n`
      : '') +

    `VERPLICHTE REACTIE PER PRE-MORTEM SCENARIO (beknopt, max 1 zin per punt):\n` +
    `① TREND ZWAKKER DAN AANGENOMEN: ${devilsAdvocate.counterConfidence > 50 ? '⚠️ hoge overtuiging — weerleg of erken' : 'beoordeel'} — houden de 4H-candles nog steeds consistent dezelfde richting aan?\n` +
    `② PULLBACK TE DIEP: is de correctie >50% van de vorige trending-swing? Dat zou een trendbreuk zijn, geen pullback.\n` +
    `③ STOP NIET LOGISCH: is het swing low/high dat als stop dient echt een significant technisch niveau, of slechts een willekeurige candle?\n` +
    `④ TP GEBLOKKEERD: zijn er weerstandszones of supply/demand gebieden tussen entry en TP die de pre-mortem herkent maar jij niet?\n` +
    `⑤ MACRO TEGENSTRIJDIG: geeft macro of geo informatie die de trendrichting in twijfel trekt?\n\n` +

    `TREND-SETUP KWALITEIT HEROVERWEGING (verplicht):\n` +
    `Heeft de discussie één van de vier trend-criteria (①–④) in twijfel getrokken?\n` +
    `• Pre-mortem vindt dat pullback te diep is → criterium ② valt weg\n` +
    `• Risicomanager vindt geen logische stop binnen $20–80 → criterium ③ valt weg\n` +
    `• Pre-mortem berekent R:R <1:1 met TP-blokkade meegewogen → criterium ④ valt weg\n` +
    `• 4H-structuur blijkt onduidelijk → criterium ① valt weg\n` +
    `Als de telling daalt, verlaag dan ook je zekerheid dienovereenkomstig.\n\n` +

    `ZEKERHEIDSREGEL (verplicht toepassen):\n` +
    `• Alle 5 scenario's weerlegd + macro bevestigt → VERHOOG zekerheid\n` +
    `• 1-2 steekhoudende punten maar trend intact → max -8% aanpassing, behoud richting\n` +
    `• Scenario ① EN ② beide bevestigd, of pullback aantoonbaar te diep → switch neutraal\n` +
    `• Eén van beiden: verlaag max -15%, richting behouden\n` +
    `• Een onveranderd percentage is gerechtvaardigd als je elk punt concreet weerlegde.` +
    `${newsContextNote}${contextNotes}`
  );
}

function buildReversalModeRebuttal({ analysis, risk, devilsAdvocate, macro, geopolitical, newsContextNote, contextNotes }) {
  return (
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
    `① HTF-structuur fout: ${devilsAdvocate.counterConfidence > 50 ? '⚠️ hoge overtuiging — moet je weerleggen of erkennen' : 'beoordeel'} — klopt de Daily/4H bias nog steeds?\n` +
    `② Institutionele val: staan we in een stop-cluster of inducement? Of is de structuur zuiver?\n` +
    `③ Timing mismatch: geeft macro of geo informatie die de timing in twijfel trekt?\n` +
    `④ Zone verwerkt: is het OB/FVG al eerder bezocht (mitigation)?\n` +
    `⑤ Genegeerd bewijs: zijn er structurele signalen die je eerder te snel afdeed?\n\n` +
    `SETUP KWALITEIT HEROVERWEGING (verplicht):\n` +
    `Heeft de discussie één van de zes kwaliteitscriteria in twijfel getrokken?\n` +
    `• Risicomanager meldt dat de entry te laat is of geen logisch OB/FVG beschikbaar → ③ of ④ valt weg\n` +
    `• Pre-mortem vindt dat de zone al bezocht was → ③ valt weg\n` +
    `• Pre-mortem vindt dat de sweep ontbrak of een institutionele val is → ④ valt weg\n` +
    `• Macro of geo contradicteert de HTF-bias → ① staat ter discussie\n` +
    `Als de telling daalt, verlaag dan ook je zekerheid dienovereenkomstig.\n\n` +

    `ZEKERHEIDSREGEL (verplicht toepassen):\n` +
    `• Alle 5 scenario's weerlegd + macro bevestigt → VERHOOG zekerheid\n` +
    `• 1-2 steekhoudende punten maar structuur intact → max -8% aanpassing, behoud richting en signaal\n` +
    `• Pre-mortem ≤75% counter + macro tegenstrijdig → dit is normaal bij een reversal-setup; verlaag max -10%, richting behouden\n` +
    `• Scenario ① OF ② duidelijk bevestigd (niet alleen gesuggereerd) → verlaag -15 tot -20%, behoud richting tenzij structuur fundamenteel breekt\n` +
    `• Scenario ① EN ② beide bevestigd, OF marktstructuur fundamenteel anders dan initieel → switch naar neutraal\n` +
    `• Pre-mortem overtuigingskracht >80% op één of meer punten → overweeg neutraal\n` +
    `• Een onveranderd percentage is gerechtvaardigd als je elk punt concreet weerlegde.` +
    `${newsContextNote}${contextNotes}`
  );
}
