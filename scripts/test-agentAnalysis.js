import {
  classifyDevilsAdvocate,
  classifyMacroAlignment,
  classifyRebuttalShift,
  classifyCeoAgreement,
  classifyConfidenceBucket,
  classifyRiskReward,
  breakdown,
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
  'rr 1.5 (reward 30 / risk 20) -> 1.5-2.5',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4380, stopLoss: 4330 } }),
  '1.5-2.5',
);
check(
  'rr 2.5 (reward 50 / risk 20) -> 1.5-2.5',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4400, stopLoss: 4330 } }),
  '1.5-2.5',
);
check(
  'rr 3.0 (reward 60 / risk 20) -> >2.5',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4410, stopLoss: 4330 } }),
  '>2.5',
);
check(
  'rr bearish richting (reward 40 / risk 30) -> <1.5',
  classifyRiskReward({ entryPrice: 4350, decision: { takeProfit: 4310, stopLoss: 4380 } }),
  '<1.5',
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

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
