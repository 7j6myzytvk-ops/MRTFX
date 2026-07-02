import {
  toLogEntry,
  summarizeConditionLog,
  formatDiagnosticsReport,
  filterConditionLog,
  formatDayReport,
  formatHourReport,
} from '../services/conditionDiagnostics.js';

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

// --- filterConditionLog ---
const timeEntries = [
  { timestamp: '2026-07-01T08:00:00.000Z', triggered: false, blockers: [], details: {} },
  { timestamp: '2026-07-01T15:00:00.000Z', triggered: true,  blockers: [], details: {} },
  { timestamp: '2026-07-01T16:00:00.000Z', triggered: false, blockers: [], details: {} },
  { timestamp: '2026-07-02T09:00:00.000Z', triggered: false, blockers: [], details: {} },
];
const filtered = filterConditionLog(timeEntries, {
  from: '2026-07-01T00:00:00.000Z',
  to:   '2026-07-01T23:59:59.999Z',
});
check('filterConditionLog -> 3 entries op 2026-07-01', filtered.length, 3);
check('filterConditionLog -> 2026-07-02 niet aanwezig', filtered.some(e => e.timestamp.startsWith('2026-07-02')), false);

const filteredHour = filterConditionLog(timeEntries, {
  from: '2026-07-01T15:00:00.000Z',
  to:   '2026-07-01T15:59:59.999Z',
});
check('filterConditionLog -> 1 entry in uur 15', filteredHour.length, 1);
check('filterConditionLog -> triggered entry in uur 15', filteredHour[0].triggered, true);

// --- formatDayReport ---
const dayReport = formatDayReport(filtered, '2026-07-01');
check('formatDayReport bevat datum', dayReport.includes('2026-07-01'), true);
check('formatDayReport bevat TRIGGER', dayReport.includes('TRIGGER'), true);
check('formatDayReport bevat 08:00', dayReport.includes('08:00'), true);

// --- formatHourReport ---
const hourEntry = {
  timestamp: '2026-07-01T15:30:00.000Z',
  triggered: true,
  direction: 'bullish',
  blockers: [],
  details: { session: true, tfAligned: true, trendAligned: true, nearLevel: true },
};
const hourReport = formatHourReport([hourEntry], '2026-07-01', 15);
check('formatHourReport bevat TRIGGER', hourReport.includes('TRIGGER'), true);
check('formatHourReport bevat 15:30', hourReport.includes('15:30'), true);
check('formatHourReport bevat richting', hourReport.includes('bullish'), true);

const blockedHourEntry = {
  timestamp: '2026-07-01T15:05:00.000Z',
  triggered: false,
  direction: null,
  blockers: ['prijs niet nabij een sleutelniveau'],
  details: { session: true, tfAligned: true, trendAligned: true, nearLevel: false },
};
const blockedHourReport = formatHourReport([blockedHourEntry], '2026-07-01', 15);
check('formatHourReport blocker -> Niv✗ aanwezig', blockedHourReport.includes('Niv✗'), true);
check('formatHourReport blocker -> TF✓ aanwezig', blockedHourReport.includes('TF✓'), true);

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
