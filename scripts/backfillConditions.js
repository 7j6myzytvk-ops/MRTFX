// Simuleert de conditie-checker met terugwerkende kracht over een historische
// periode, met de ECHTE candle-data van die dagen. Dit is GEEN aanpassing van
// het live systeem - puur lokale analyse om te zien welke conditie de
// afgelopen dagen het vaakst geblokkeerd zou hebben, vóórdat we op 3 juli
// besluiten of/welke aanpassing nodig is.
//
// Gebruik: node scripts/backfillConditions.js [vanaf-datum] [tot-datum]
// Standaard: vanaf 2026-06-22T00:00:00Z (start van de live testfase) tot nu.
//
// Bekende vereenvoudiging: D1/W1-trendcontext wordt één keer opgehaald (als
// snapshot van nu), niet point-in-time per gesimuleerd moment. D1/W1-trend
// verandert traag (dagen/weken), dus over een venster van een paar dagen is
// het effect van deze aanname klein - maar het is geen perfecte reconstructie.

import { getXauUsdCandles, getRecentXauD1Candles, getRecentXauW1Candles } from '../services/marketData.js';
import { filterFlatCandles } from '../agents/outcomeEvaluator.js';
import { checkConditions, isActiveSession } from '../services/conditionChecker.js';
import { toLogEntry, summarizeConditionLog, formatDiagnosticsReport } from '../services/conditionDiagnostics.js';

const DEFAULT_FROM = '2026-06-22T00:00:00Z';
const from = process.argv[2] ? new Date(process.argv[2]) : new Date(DEFAULT_FROM);
const to = process.argv[3] ? new Date(process.argv[3]) : new Date();

// Extra buffer vóór `from` zodat computeTimeframeBias (min. 20 candles) al bij
// de eerste gesimuleerde poll genoeg historie heeft.
const fetchFrom = new Date(from.getTime() - 5 * 24 * 60 * 60 * 1000);

console.log(`Candles ophalen van ${fetchFrom.toISOString()} t/m ${to.toISOString()}...`);

const [h1Raw, m30Raw, m15Raw, d1Candles, w1Candles] = await Promise.all([
  getXauUsdCandles({ granularity: 'H1', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getXauUsdCandles({ granularity: 'M30', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getXauUsdCandles({ granularity: 'M15', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getRecentXauD1Candles({ count: 30 }),
  getRecentXauW1Candles({ count: 20 }),
]);

const h1Candles = filterFlatCandles(h1Raw);
const m30Candles = filterFlatCandles(m30Raw);
const m15Candles = filterFlatCandles(m15Raw);

console.log(`H1: ${h1Candles.length} | M30: ${m30Candles.length} | M15: ${m15Candles.length} (na filteren synthetische candles)`);
console.log(`D1: ${d1Candles.length} | W1: ${w1Candles.length} (snapshot van nu, zie kanttekening in bestandsheader)\n`);

const entries = [];
let simulated = 0;
let skippedNoData = 0;

for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 60 * 60 * 1000)) {
  if (!isActiveSession(t)) continue; // zelfde gedrag als live scheduler.js: alleen binnen sessie loggen

  const iso = t.toISOString();
  const h1Slice = h1Candles.filter((c) => c.time <= iso).slice(-50);
  const m30Slice = m30Candles.filter((c) => c.time <= iso).slice(-100);
  const m15Slice = m15Candles.filter((c) => c.time <= iso).slice(-100);

  if (h1Slice.length < 20 || m30Slice.length < 20 || m15Slice.length < 20) {
    skippedNoData++;
    continue;
  }

  simulated++;
  const conditions = checkConditions({ h1Candles: h1Slice, m30Candles: m30Slice, m15Candles: m15Slice, d1Candles, w1Candles, now: t });
  entries.push(toLogEntry(conditions, t));
}

console.log(`${simulated} uren gesimuleerd binnen sessievenster, ${skippedNoData} overgeslagen (te weinig historie).\n`);

const summary = summarizeConditionLog(entries);
console.log(formatDiagnosticsReport(summary));

if (summary.triggered > 0) {
  console.log('\nGetriggerde momenten:');
  entries.filter((e) => e.triggered).forEach((e) => console.log(`  ${e.timestamp} -> ${e.direction}`));
}
