import { toLogEntry, summarizeConditionLog, formatDiagnosticsReport } from '../services/conditionDiagnostics.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? 'OK  ' : 'FAIL', label);
  if (!ok) {
    console.log('  verwacht:', JSON.stringify(expected));
    console.log('  ontvangen:', JSON.stringify(actual));
    fail++;
  } else {
    pass++;
  }
}

const now = new Date('2026-06-27T12:00:00Z');

// --- toLogEntry: alles geslaagd (triggered) ---
const triggeredConditions = {
  triggered: true,
  direction: 'bullish',
  blockers: [],
  details: {
    session: true,
    tfAlignment: { aligned: true, direction: 'bullish' },
    trendBias: { aligned: true, direction: 'bullish' },
    nearLevel: { near: true, label: 'pivot' },
  },
};
const triggeredEntry = toLogEntry(triggeredConditions, now);
check('toLogEntry triggered -> triggered=true', triggeredEntry.triggered, true);
check('toLogEntry triggered -> direction=bullish', triggeredEntry.direction, 'bullish');
check('toLogEntry triggered -> directionConsistent=true', triggeredEntry.details.directionConsistent, true);
check('toLogEntry triggered -> timestamp ISO', triggeredEntry.timestamp, '2026-06-27T12:00:00.000Z');

// --- toLogEntry: sessie inactief, rest niet van toepassing qua directionConsistent ---
const blockedConditions = {
  triggered: false,
  direction: null,
  blockers: ['buiten actieve sessie (08:00–17:00 UTC)', 'timeframes niet aligned (H1: bearish, M30: bullish, M15: bullish)'],
  details: {
    session: false,
    tfAlignment: { aligned: false, direction: null },
    trendBias: { aligned: true, direction: 'bearish' },
    nearLevel: { near: false },
  },
};
const blockedEntry = toLogEntry(blockedConditions, now);
check('toLogEntry blocked -> triggered=false', blockedEntry.triggered, false);
check('toLogEntry blocked -> direction=null', blockedEntry.direction, null);
check('toLogEntry blocked -> session=false', blockedEntry.details.session, false);
check('toLogEntry blocked -> tfAligned=false', blockedEntry.details.tfAligned, false);
check('toLogEntry blocked -> directionConsistent=null (tf niet aligned)', blockedEntry.details.directionConsistent, null);

// --- summarizeConditionLog: lege log ---
const emptySummary = summarizeConditionLog([]);
check('summarize empty -> n=0', emptySummary.n, 0);
check('summarize empty -> triggered=0', emptySummary.triggered, 0);

// --- summarizeConditionLog: gemengde set ---
const entries = [
  triggeredEntry,
  blockedEntry,
  blockedEntry,
  toLogEntry({
    triggered: false,
    direction: null,
    blockers: ['prijs niet nabij een sleutelniveau'],
    details: {
      session: true,
      tfAlignment: { aligned: true, direction: 'bullish' },
      trendBias: { aligned: true, direction: 'bullish' },
      nearLevel: { near: false },
    },
  }, now),
];
const summary = summarizeConditionLog(entries);
check('summarize mixed -> n=4', summary.n, 4);
check('summarize mixed -> triggered=1', summary.triggered, 1);
check(
  'summarize mixed -> blockerCounts telt sessie 2x',
  summary.blockerCounts['buiten actieve sessie (08:00–17:00 UTC)'],
  2,
);
check(
  'summarize mixed -> blockerCounts telt sleutelniveau 1x',
  summary.blockerCounts['prijs niet nabij een sleutelniveau'],
  1,
);
// session: true,false,false,true -> 2/4 = 50%
check('summarize mixed -> session passrate 50%', summary.conditionPassRate.session, 50);
// tfAligned: true,false,false,true -> 2/4 = 50%
check('summarize mixed -> tfAligned passrate 50%', summary.conditionPassRate.tfAligned, 50);
// directionConsistent: alleen van toepassing bij entry 1 en 4 (tf+trend beide aligned) -> true,true -> 100%
check('summarize mixed -> directionConsistent passrate 100% (n.v.t. uitgesloten)', summary.conditionPassRate.directionConsistent, 100);

// --- formatDiagnosticsReport ---
check('formatDiagnosticsReport lege summary', formatDiagnosticsReport({ n: 0 }), 'Nog geen diagnostiek-data verzameld.');
const report = formatDiagnosticsReport(summary);
check('formatDiagnosticsReport bevat poll-aantal', report.includes('4 polls'), true);
check('formatDiagnosticsReport bevat triggered-aantal', report.includes('1 getriggerd'), true);

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
