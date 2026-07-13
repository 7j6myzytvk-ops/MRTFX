import {
  classifyDevilsAdvocate,
  classifyMacroAlignment,
  classifyRebuttalShift,
  classifyCeoAgreement,
  classifyConfidenceBucket,
  classifyRiskReward,
  isComboSignal,
  breakdown,
  assessSignalQuality,
} from '../agents/agentAnalysis.js';

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log(`     verwacht: ${JSON.stringify(expected)}`);
    console.log(`     gekregen: ${JSON.stringify(actual)}`);
    fail++;
  } else {
    pass++;
  }
}

// --- classifyDevilsAdvocate ---
check(
  'DA tegengesteld aan besluit -> oneens',
  classifyDevilsAdvocate({ decision: { signal: 'bullish' }, discussion: { devilsAdvocate: { counterSignal: 'bearish' } } }),
  'oneens',
);
check(
  'DA zelfde richting als besluit -> eens',
  classifyDevilsAdvocate({ decision: { signal: 'bullish' }, discussion: { devilsAdvocate: { counterSignal: 'bullish' } } }),
  'eens',
);

// --- classifyMacroAlignment ---
check(
  'risk-on + bullish -> aligned',
  classifyMacroAlignment({ decision: { signal: 'bullish' }, discussion: { macro: { sentiment: 'risk-on' } } }),
  'aligned',
);
check(
  'risk-off + bearish -> aligned',
  classifyMacroAlignment({ decision: { signal: 'bearish' }, discussion: { macro: { sentiment: 'risk-off' } } }),
  'aligned',
);
check(
  'risk-on + bearish -> contrarian',
  classifyMacroAlignment({ decision: { signal: 'bearish' }, discussion: { macro: { sentiment: 'risk-on' } } }),
  'contrarian',
);
check(
  'risk-off + bullish -> contrarian',
  classifyMacroAlignment({ decision: { signal: 'bullish' }, discussion: { macro: { sentiment: 'risk-off' } } }),
  'contrarian',
);
check(
  'sentiment neutraal -> neutraal',
  classifyMacroAlignment({ decision: { signal: 'bullish' }, discussion: { macro: { sentiment: 'neutraal' } } }),
  'neutraal',
);
check(
  'besluit neutral -> neutraal',
  classifyMacroAlignment({ decision: { signal: 'neutral' }, discussion: { macro: { sentiment: 'risk-on' } } }),
  'neutraal',
);

// --- classifyRebuttalShift ---
check(
  'zekerheid omlaag na weerwoord',
  classifyRebuttalShift({ discussion: { analyst: { confidence: 70 }, analystRebuttal: { confidence: 60 } } }),
  'omlaag',
);
check(
  'zekerheid gelijk na weerwoord',
  classifyRebuttalShift({ discussion: { analyst: { confidence: 70 }, analystRebuttal: { confidence: 70 } } }),
  'gelijk',
);
check(
  'zekerheid omhoog na weerwoord',
  classifyRebuttalShift({ discussion: { analyst: { confidence: 60 }, analystRebuttal: { confidence: 70 } } }),
  'omhoog',
);

// --- classifyCeoAgreement ---
check(
  'CEO volgt eerste analyse',
  classifyCeoAgreement({ decision: { signal: 'bullish' }, discussion: { analyst: { signal: 'bullish' } } }),
  'volgt-analist',
);
check(
  'CEO wijkt af van eerste analyse',
  classifyCeoAgreement({ decision: { signal: 'bearish' }, discussion: { analyst: { signal: 'bullish' } } }),
  'wijkt-af',
);

// --- classifyConfidenceBucket ---
check('confidence 55 -> <60%', classifyConfidenceBucket({ decision: { confidence: 55 } }), '<60%');
check('confidence 60 -> 60-70%', classifyConfidenceBucket({ decision: { confidence: 60 } }), '60-70%');
check('confidence 70 -> 60-70%', classifyConfidenceBucket({ decision: { confidence: 70 } }), '60-70%');
check('confidence 75 -> >70%', classifyConfidenceBucket({ decision: { confidence: 75 } }), '>70%');

// --- classifyRiskReward ---
check(
  'rr 1.0 (reward 20 / risk 20) -> <1.5',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4370, stopLoss: 4330 } }),
  '<1.5',
);
check(
  'rr 1.5 (reward 30 / risk 20) -> 1.5-3.0',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4380, stopLoss: 4330 } }),
  '1.5-3.0',
);
check(
  'rr 2.5 (reward 50 / risk 20) -> 1.5-3.0',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4400, stopLoss: 4330 } }),
  '1.5-3.0',
);
check(
  'rr 3.0 (reward 60 / risk 20) -> 1.5-3.0 (grens)',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4410, stopLoss: 4330 } }),
  '1.5-3.0',
);
check(
  'rr 3.5 (reward 70 / risk 20) -> >3.0',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4420, stopLoss: 4330 } }),
  '>3.0',
);
check(
  'rr bearish richting (reward 40 / risk 30) -> <1.5',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4310, stopLoss: 4380 } }),
  '<1.5',
);

// --- isComboSignal ---
// Combo = rebuttal omhoog + setupQualityScore >= 5
check(
  'omhoog + score 5 -> combo',
  isComboSignal({
    discussion: { analyst: { confidence: 60, setupQualityScore: 5 }, analystRebuttal: { confidence: 70 } },
    entryPrice: 4350,
    decision: { takeProfit: 4400, stopLoss: 4330 },
  }),
  true,
);
check(
  'omhoog + score 6 -> combo',
  isComboSignal({
    discussion: { analyst: { confidence: 60, setupQualityScore: 6 }, analystRebuttal: { confidence: 70 } },
    entryPrice: 4350,
    decision: { takeProfit: 4400, stopLoss: 4330 },
  }),
  true,
);
check(
  'omhoog + score 4 -> geen combo (te lage score)',
  isComboSignal({
    discussion: { analyst: { confidence: 60, setupQualityScore: 4 }, analystRebuttal: { confidence: 70 } },
    entryPrice: 4350,
    decision: { takeProfit: 4400, stopLoss: 4330 },
  }),
  false,
);
check(
  'omhoog + score ontbreekt -> geen combo (default 0)',
  isComboSignal({
    discussion: { analyst: { confidence: 60 }, analystRebuttal: { confidence: 70 } },
    entryPrice: 4350,
    decision: { takeProfit: 4400, stopLoss: 4330 },
  }),
  false,
);
check(
  'omlaag + score 5 -> geen combo (rebuttal daalde)',
  isComboSignal({
    discussion: { analyst: { confidence: 70, setupQualityScore: 5 }, analystRebuttal: { confidence: 60 } },
    entryPrice: 4350,
    decision: { takeProfit: 4400, stopLoss: 4330 },
  }),
  false,
);
check(
  'gelijk + score 5 -> geen combo (rebuttal gelijk)',
  isComboSignal({
    discussion: { analyst: { confidence: 70, setupQualityScore: 5 }, analystRebuttal: { confidence: 70 } },
    entryPrice: 4350,
    decision: { takeProfit: 4400, stopLoss: 4330 },
  }),
  false,
);
check(
  'omhoog + score 5 + neutraal CEO -> geen combo (CEO zegt geen actie)',
  isComboSignal({
    discussion: { analyst: { confidence: 60, setupQualityScore: 5 }, analystRebuttal: { confidence: 70 } },
    entryPrice: 4350,
    decision: { signal: 'neutral', takeProfit: 4400, stopLoss: 4330 },
  }),
  false,
);

// --- breakdown ---
{
  const samples = [
    // confidence 70 -> '60-70%', tp
    { decision: { confidence: 70 }, discussion: {}, outcome: { result: 'tp', candlesToHit: 2 } },
    // confidence 65 -> '60-70%', sl
    { decision: { confidence: 65 }, discussion: {}, outcome: { result: 'sl', candlesToHit: 1 } },
    // confidence 75 -> '>70%', tp
    { decision: { confidence: 75 }, discussion: {}, outcome: { result: 'tp', candlesToHit: 4 } },
    // confidence 55 -> '<60%', maar GEEN discussion -> moet overgeslagen worden
    { decision: { confidence: 55 }, outcome: { result: 'sl', candlesToHit: 1 } },
  ];

  const result = breakdown(samples, classifyConfidenceBucket, ['<60%', '60-70%', '>70%']);

  check('breakdown <60% (leeg, sample zonder discussion overgeslagen)', result[0], {
    label: '<60%',
    totalSamples: 0,
    neutraal: 0,
    trades: 0,
    tp: 0,
    sl: 0,
    geen: 0,
    winRate: null,
    avgConfidenceTp: null,
    avgConfidenceSl: null,
  });
  check('breakdown 60-70% (1 tp @70%, 1 sl @65%)', result[1], {
    label: '60-70%',
    totalSamples: 2,
    neutraal: 0,
    trades: 2,
    tp: 1,
    sl: 1,
    geen: 0,
    winRate: 50,
    avgConfidenceTp: 70,
    avgConfidenceSl: 65,
  });
  check('breakdown >70% (1 tp @75%)', result[2], {
    label: '>70%',
    totalSamples: 1,
    neutraal: 0,
    trades: 1,
    tp: 1,
    sl: 0,
    geen: 0,
    winRate: 100,
    avgConfidenceTp: 75,
    avgConfidenceSl: null,
  });
}

// --- assessSignalQuality ---
{
  const base = {
    entryPrice: 3000,
    decision: { signal: 'bullish', confidence: 65, stopLoss: 2950, takeProfit: 3100 },
    discussion: {
      analyst: { confidence: 60 },
      analystRebuttal: { confidence: 65 }, // omhoog
      macro: { sentiment: 'risk-off' },    // risk-off + bullish = contrarian
      devilsAdvocate: { counterSignal: 'bearish' },
      riskManager: {},
    },
  };

  // Alle filters groen
  const groen = {
    ...base,
    decision: { signal: 'bullish', confidence: 65, stopLoss: 2950, takeProfit: 3100 },
    discussion: {
      ...base.discussion,
      macro: { sentiment: 'risk-on' }, // aligned
    },
  };
  check('assessSignalQuality - alles groen -> passed', assessSignalQuality(groen), { passed: true, blockers: [] });

  // Zekerheid te laag
  const laag = { ...base, decision: { ...base.decision, confidence: 55 }, discussion: { ...base.discussion, macro: { sentiment: 'risk-on' } } };
  check('assessSignalQuality - confidence 55 -> geblokkeerd', assessSignalQuality(laag).passed, false);
  check('assessSignalQuality - confidence 55 -> juiste blocker', assessSignalQuality(laag).blockers.includes('CEO-zekerheid onder 65%'), true);

  // Grenswaarde: 64 = geblokkeerd, 65 = niet geblokkeerd
  const grens64 = { ...base, decision: { ...base.decision, confidence: 64 }, discussion: { ...base.discussion, macro: { sentiment: 'risk-on' } } };
  check('assessSignalQuality - confidence 64 -> geblokkeerd', assessSignalQuality(grens64).passed, false);
  const grens65 = { ...base, decision: { ...base.decision, confidence: 65 }, discussion: { ...base.discussion, macro: { sentiment: 'risk-on' } } };
  check('assessSignalQuality - confidence 65 -> niet geblokkeerd op zekerheid', assessSignalQuality(grens65).blockers.includes('CEO-zekerheid onder 65%'), false);

  // Macro contraireert
  check('assessSignalQuality - macro contrarian -> geblokkeerd', assessSignalQuality(base).blockers.includes('macro contraireert de richting'), true);

  // Rebuttal omlaag
  const rebuttalDaalt = {
    ...groen,
    discussion: { ...groen.discussion, analystRebuttal: { confidence: 55 } }, // omlaag
  };
  check('assessSignalQuality - rebuttal omlaag -> geblokkeerd', assessSignalQuality(rebuttalDaalt).blockers.includes('analist verloor vertrouwen na discussie'), true);

  // Neutraal signaal altijd doorgelaten
  const neutraal = { ...base, decision: { ...base.decision, signal: 'neutral', confidence: 45 } };
  check('assessSignalQuality - neutral signaal altijd passed', assessSignalQuality(neutraal), { passed: true, blockers: [] });

  // Geen discussion -> altijd passed
  check('assessSignalQuality - geen discussion -> passed', assessSignalQuality({ decision: { signal: 'bullish', confidence: 45 } }), { passed: true, blockers: [] });

  // R:R te hoog (>2.5): entryPrice 3000, SL 2990 (risk 10), TP 3100 (reward 100) -> RR 10
  const rrTeHoog = {
    ...groen,
    entryPrice: 3000,
    decision: { ...groen.decision, stopLoss: 2990, takeProfit: 3100 },
  };
  check('assessSignalQuality - R:R >3.0 -> geblokkeerd', assessSignalQuality(rrTeHoog).blockers.includes('risico/winst-verhouding te ambitieus (>3.0)'), true);
  check('assessSignalQuality - R:R >3.0 -> passed false', assessSignalQuality(rrTeHoog).passed, false);

  // Geen entryPrice: R:R-filter mag niet triggeren
  const geenEntry = { ...groen, entryPrice: undefined };
  check('assessSignalQuality - geen entryPrice -> R:R niet geblokkeerd', assessSignalQuality(geenEntry).blockers.includes('risico/winst-verhouding te ambitieus (>3.0)'), false);

  // Pre-mortem: counterConfidence >70 -> blocker
  const premortemSterk = {
    ...groen,
    discussion: { ...groen.discussion, devilsAdvocate: { counterSignal: 'bearish', counterConfidence: 75 } },
  };
  check('assessSignalQuality - pre-mortem >70% -> geblokkeerd', assessSignalQuality(premortemSterk).passed, false);
  check('assessSignalQuality - pre-mortem >70% -> juiste blocker', assessSignalQuality(premortemSterk).blockers.includes('pre-mortem: duidelijk faalscenario gevonden (>70%)'), true);

  // Pre-mortem: counterConfidence <=70 -> niet geblokkeerd
  const premortemZwak = {
    ...groen,
    discussion: { ...groen.discussion, devilsAdvocate: { counterSignal: 'bearish', counterConfidence: 70 } },
  };
  check('assessSignalQuality - pre-mortem <=70% -> niet geblokkeerd', assessSignalQuality(premortemZwak).blockers.includes('pre-mortem: duidelijk faalscenario gevonden (>70%)'), false);

  // Pre-mortem ontbreekt in discussion -> geen crash
  const geenDA = {
    ...groen,
    discussion: { ...groen.discussion, devilsAdvocate: undefined },
  };
  check('assessSignalQuality - geen devilsAdvocate -> geen crash', assessSignalQuality(geenDA).passed, true);

  // --- Counter-trend filter ---

  // Bearish signaal, D1+W1 beide bullish → geblokkeerd
  const ctBearishVsBull = {
    ...groen,
    decision: { signal: 'bearish', confidence: 67, stopLoss: 3050, takeProfit: 2950 },
    dailyTrend: 'bullish',
    weeklyTrend: 'bullish',
  };
  check('assessSignalQuality - bearish vs D1+W1 bullish -> geblokkeerd', assessSignalQuality(ctBearishVsBull).passed, false);
  check('assessSignalQuality - bearish vs D1+W1 bullish -> juiste blocker',
    assessSignalQuality(ctBearishVsBull).blockers.some(b => b.includes('counter-trend')), true);

  // Bullish signaal, D1+W1 beide bearish → geblokkeerd
  const ctBullishVsBear = {
    ...groen,
    decision: { signal: 'bullish', confidence: 67, stopLoss: 2950, takeProfit: 3050 },
    dailyTrend: 'bearish',
    weeklyTrend: 'bearish',
  };
  check('assessSignalQuality - bullish vs D1+W1 bearish -> geblokkeerd', assessSignalQuality(ctBullishVsBear).passed, false);

  // Bearish signaal, D1+W1 beide bearish → NIET geblokkeerd (met-trend)
  const metTrend = {
    ...groen,
    decision: { signal: 'bearish', confidence: 67, stopLoss: 3050, takeProfit: 2950 },
    dailyTrend: 'bearish',
    weeklyTrend: 'bearish',
  };
  check('assessSignalQuality - bearish met D1+W1 bearish -> niet geblokkeerd',
    assessSignalQuality(metTrend).blockers.some(b => b.includes('counter-trend')), false);

  // D1 en W1 wijken af → geen blocker (tegenstrijdige trends)
  const mixedTrend = {
    ...groen,
    decision: { signal: 'bearish', confidence: 67, stopLoss: 3050, takeProfit: 2950 },
    dailyTrend: 'bullish',
    weeklyTrend: 'bearish',
  };
  check('assessSignalQuality - D1 bullish / W1 bearish -> niet geblokkeerd',
    assessSignalQuality(mixedTrend).blockers.some(b => b.includes('counter-trend')), false);

  // D1 neutraal → geen blocker
  const d1Neutraal = {
    ...groen,
    decision: { signal: 'bearish', confidence: 67, stopLoss: 3050, takeProfit: 2950 },
    dailyTrend: 'neutraal',
    weeklyTrend: 'bullish',
  };
  check('assessSignalQuality - D1 neutraal -> geen counter-trend blocker',
    assessSignalQuality(d1Neutraal).blockers.some(b => b.includes('counter-trend')), false);

  // Geen trenddata → geen blocker (geen false positive)
  const geenTrend = {
    ...groen,
    decision: { signal: 'bearish', confidence: 67, stopLoss: 3050, takeProfit: 2950 },
  };
  check('assessSignalQuality - geen trenddata -> geen counter-trend blocker',
    assessSignalQuality(geenTrend).blockers.some(b => b.includes('counter-trend')), false);

  // --- Setup-kwaliteitsscore filter ---

  // Score 2 → geblokkeerd
  const laagScore = {
    ...groen,
    discussion: { ...groen.discussion, analyst: { confidence: 60, setupQualityScore: 2 } },
  };
  check('assessSignalQuality - setupQualityScore 2 -> geblokkeerd', assessSignalQuality(laagScore).passed, false);
  check('assessSignalQuality - setupQualityScore 2 -> juiste blocker',
    assessSignalQuality(laagScore).blockers.some(b => b.includes('setup-kwaliteit te laag')), true);

  // Score 3 → NIET geblokkeerd (grenswaarde)
  const grensScore = {
    ...groen,
    discussion: { ...groen.discussion, analyst: { confidence: 60, setupQualityScore: 3 } },
  };
  check('assessSignalQuality - setupQualityScore 3 -> niet geblokkeerd',
    assessSignalQuality(grensScore).blockers.some(b => b.includes('setup-kwaliteit')), false);

  // Score ontbreekt (oude samples) → geen blocker
  const geenScore = {
    ...groen,
    discussion: { ...groen.discussion, analyst: { confidence: 60 } },
  };
  check('assessSignalQuality - geen setupQualityScore -> geen blocker',
    assessSignalQuality(geenScore).blockers.some(b => b.includes('setup-kwaliteit')), false);

  // Score 0 → geblokkeerd (zekerste geval)
  const nulScore = {
    ...groen,
    discussion: { ...groen.discussion, analyst: { confidence: 60, setupQualityScore: 0 } },
  };
  check('assessSignalQuality - setupQualityScore 0 -> geblokkeerd', assessSignalQuality(nulScore).passed, false);

  // --- Filter 8: ATR te laag ---

  const atrTeKort = { ...groen, atr14: 10 };
  check('assessSignalQuality - ATR $10 (< $13) -> geblokkeerd', assessSignalQuality(atrTeKort).passed, false);
  check('assessSignalQuality - ATR $10 -> juiste blocker',
    assessSignalQuality(atrTeKort).blockers.some((b) => b.includes('ATR te laag')), true);

  const atrGrens = { ...groen, atr14: 13 };
  check('assessSignalQuality - ATR $13 (grenswaarde, niet < 13) -> niet geblokkeerd',
    assessSignalQuality(atrGrens).blockers.some((b) => b.includes('ATR te laag')), false);

  const atrVoldoende = { ...groen, atr14: 20 };
  check('assessSignalQuality - ATR $20 -> niet geblokkeerd',
    assessSignalQuality(atrVoldoende).blockers.some((b) => b.includes('ATR te laag')), false);

  check('assessSignalQuality - ATR ontbreekt -> geen blocker',
    assessSignalQuality(groen).blockers.some((b) => b.includes('ATR te laag')), false);

  // --- Filter 9: Overextended move (SMA-gap > $50) ---

  // Bearish base: risk-off + geen trenddata, zodat alleen SMA-filter triggert
  const groenBearish = {
    ...groen,
    entryPrice: 3000,
    decision: { signal: 'bearish', confidence: 65, stopLoss: 3050, takeProfit: 2950 },
    discussion: { ...groen.discussion, macro: { sentiment: 'risk-off' } },
    dailyTrend: undefined,
    weeklyTrend: undefined,
  };

  // Bearish: gap = 3000 - 3060 = -60 < -50 → geblokkeerd
  const bearishOverextended = { ...groenBearish, sma20H1: 3060 };
  check('assessSignalQuality - bearish $60 onder SMA20 -> geblokkeerd', assessSignalQuality(bearishOverextended).passed, false);
  check('assessSignalQuality - bearish overextended -> juiste blocker',
    assessSignalQuality(bearishOverextended).blockers.some((b) => b.includes('overextended')), true);

  // Bearish: gap = -50 (exacte grens, strict < -50 nodig) → NIET geblokkeerd
  const bearishGrens = { ...groenBearish, sma20H1: 3050 };
  check('assessSignalQuality - bearish $50 onder SMA20 (grens, niet < -50) -> niet geblokkeerd',
    assessSignalQuality(bearishGrens).blockers.some((b) => b.includes('overextended')), false);

  // Bearish: gap = -20 → niet geblokkeerd
  const bearishDichtbij = { ...groenBearish, sma20H1: 3020 };
  check('assessSignalQuality - bearish $20 onder SMA20 -> niet geblokkeerd',
    assessSignalQuality(bearishDichtbij).blockers.some((b) => b.includes('overextended')), false);

  // Bullish: gap = 3060 - 3000 = +60 > 50 → geblokkeerd
  const bullishOverextended = { ...groen, entryPrice: 3060, sma20H1: 3000 };
  check('assessSignalQuality - bullish $60 boven SMA20 -> geblokkeerd', assessSignalQuality(bullishOverextended).passed, false);
  check('assessSignalQuality - bullish overextended -> juiste blocker',
    assessSignalQuality(bullishOverextended).blockers.some((b) => b.includes('overextended')), true);

  // Bullish: gap = +40 → niet geblokkeerd
  const bullishDichtbij = { ...groen, entryPrice: 3040, sma20H1: 3000 };
  check('assessSignalQuality - bullish $40 boven SMA20 -> niet geblokkeerd',
    assessSignalQuality(bullishDichtbij).blockers.some((b) => b.includes('overextended')), false);

  // Geen sma20H1 → geen blocker (geen false positive)
  check('assessSignalQuality - geen sma20H1 -> geen overextended blocker',
    assessSignalQuality(groen).blockers.some((b) => b.includes('overextended')), false);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
