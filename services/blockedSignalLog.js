import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getXauUsdCandles } from './marketData.js';
import { filterFlatCandles, HORIZON_CANDLES, evaluateOutcome } from '../agents/outcomeEvaluator.js';

const LOG_FILE = path.join(process.cwd(), 'data', 'live', 'blockedSignals.json');

async function readLog() {
  try {
    const raw = await readFile(LOG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeLog(entries) {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await writeFile(LOG_FILE, JSON.stringify(entries, null, 2));
}

export async function logBlockedSignal({ decision, qualityResult, discussion, entryPrice, atr14 }) {
  if (!qualityResult || qualityResult.passed) return;

  const sl = decision.stopLoss ?? null;
  const tp = decision.takeProfit ?? null;
  const entry = entryPrice ?? null;
  let riskReward = null;
  if (sl !== null && tp !== null && entry !== null && Math.abs(entry - sl) > 0) {
    riskReward = Math.abs(tp - entry) / Math.abs(entry - sl);
    riskReward = Math.round(riskReward * 100) / 100;
  }

  const entries = await readLog();
  entries.push({
    timestamp: new Date().toISOString(),
    signal: decision.signal,
    confidence: decision.confidence,
    blockers: qualityResult.blockers ?? [],
    setupScore: discussion?.analyst?.setupQualityScore ?? null,
    amdPhase: discussion?.analyst?.amdPhase ?? null,
    entryPrice: entry,
    stopLoss: sl,
    takeProfit: tp,
    entryZone: decision.entryZone ?? null,
    riskReward,
    atr14: atr14 ?? null,
    outcome: null,
  });

  await writeLog(entries);
}

// Evalueert outcomes voor geblokkeerde signalen met SL/TP-data maar nog geen uitkomst.
// Werkt hetzelfde als evaluateOpenSignals in performanceTracker.js, maar op blockedSignals.json.
// Zo kan de WR van gefilterde signalen straks vergeleken worden met die van doorgekomen signalen.
export async function evaluateBlockedSignalOutcomes() {
  const entries = await readLog();
  const pending = entries.filter(
    (e) => e.outcome === null && e.stopLoss !== null && e.takeProfit !== null && e.signal && e.signal !== 'neutral',
  );

  if (pending.length === 0) return { checked: 0, updated: 0 };

  const earliest = pending.reduce((min, e) => (e.timestamp < min ? e.timestamp : min), pending[0].timestamp);
  const from = new Date(new Date(earliest).getTime() - 60 * 60 * 1000);
  const to = new Date();

  const rawCandles = await getXauUsdCandles({ granularity: 'H1', from: from.toISOString(), to: to.toISOString() });
  const candles = filterFlatCandles(rawCandles);

  let updated = 0;
  for (const entry of entries) {
    if (entry.outcome !== null || !entry.stopLoss || !entry.takeProfit || !entry.signal || entry.signal === 'neutral') continue;

    const startIdx = candles.findIndex((c) => c.time > entry.timestamp);
    if (startIdx === -1) continue;

    const horizonCandles = candles.slice(startIdx, startIdx + HORIZON_CANDLES);
    if (horizonCandles.length < HORIZON_CANDLES) continue; // horizon nog niet voorbij

    const decision = { signal: entry.signal, stopLoss: entry.stopLoss, takeProfit: entry.takeProfit };
    const outcome = evaluateOutcome(decision, horizonCandles);
    entry.outcome = outcome;
    updated++;
  }

  if (updated > 0) await writeLog(entries);
  return { checked: pending.length, updated };
}

export async function getBlockedSignals() {
  return readLog();
}
