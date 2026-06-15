import { getXauUsdCandles } from './marketData.js';
import { getAllSignals, updateSignalOutcome } from '../data/store.js';
import { filterFlatCandles, HORIZON_CANDLES, evaluateOutcome } from '../agents/outcomeEvaluator.js';
import { reportOutcomes } from './boardroomReporter.js';

// 'neutraal' (CEO nam geen positie) en 'onbruikbaar' (prijsschaal-mismatch) worden
// direct bij de eerste evaluatie bepaald - dat is geen afgewacht handelsresultaat
// en dus geen melding waard. Alleen tp/sl/geen zijn na de horizon-periode bekend.
const NOTIFIABLE_RESULTS = new Set(['tp', 'sl', 'geen']);

// Als het midpoint van SL/TP meer dan dit percentage afwijkt van de actuele
// candle-prijs, komt het signaal uit een andere prijsschaal (bv. pre-migratie
// mock-data) en is het niet zinvol te evalueren tegen live candles.
const PRICE_SANITY_RATIO = 0.3;

// Bepaalt de outcome voor één signaal op basis van de candles ná het signaal.
// Pure functie (geen I/O) zodat alle paden (tp/sl/geen/open/neutraal/onbruikbaar)
// los van marktdata en data/store.js te testen zijn.
export function evaluateSignalOutcome(decision, horizonCandles) {
  if (decision.signal === 'neutral') {
    return { result: 'neutraal', candlesToHit: null };
  }

  if (horizonCandles.length === 0) {
    return { result: 'open', candlesChecked: 0 };
  }

  const midpoint = (decision.stopLoss + decision.takeProfit) / 2;
  const currentPrice = horizonCandles[0].close;
  const priceRatio = Math.abs(midpoint - currentPrice) / currentPrice;

  if (priceRatio > PRICE_SANITY_RATIO) {
    return { result: 'onbruikbaar', reason: 'priceScaleMismatch' };
  }

  const outcome = evaluateOutcome(decision, horizonCandles);
  if (outcome.result === 'tp' || outcome.result === 'sl') {
    return { ...outcome, resolvedAt: horizonCandles[outcome.candlesToHit - 1].time };
  }
  if (outcome.result === 'geen' && horizonCandles.length < HORIZON_CANDLES) {
    return { result: 'open', candlesChecked: horizonCandles.length };
  }
  return outcome;
}

export async function evaluateOpenSignals(client) {
  const all = await getAllSignals();
  const pending = all.filter((s) => !s.outcome || s.outcome.result === 'open');

  if (pending.length === 0) {
    return { checked: 0, updated: [] };
  }

  const earliest = pending.reduce((min, s) => (s.timestamp < min ? s.timestamp : min), pending[0].timestamp);
  const from = new Date(new Date(earliest).getTime() - 60 * 60 * 1000);
  const to = new Date();

  const rawCandles = await getXauUsdCandles({ granularity: 'H1', from: from.toISOString(), to: to.toISOString() });
  const candles = filterFlatCandles(rawCandles);

  const updated = [];
  const resolved = [];
  for (const signal of pending) {
    const { decision } = signal;
    const startIdx = candles.findIndex((c) => c.time > signal.timestamp);
    const horizonCandles = startIdx === -1 ? [] : candles.slice(startIdx, startIdx + HORIZON_CANDLES);

    const outcome = evaluateSignalOutcome(decision, horizonCandles);

    await updateSignalOutcome(signal.id, outcome);
    const entry = { id: signal.id, timestamp: signal.timestamp, decision, outcome };
    updated.push(entry);
    if (NOTIFIABLE_RESULTS.has(outcome.result)) resolved.push(entry);

    console.log(
      `[performance] signaal #${signal.id} (${signal.timestamp}) -> ${outcome.result}` +
        (outcome.candlesToHit ? ` (na ${outcome.candlesToHit} candles)` : ''),
    );
  }

  if (client && resolved.length > 0) {
    await reportOutcomes(client, resolved);
  }

  return { checked: pending.length, updated };
}
