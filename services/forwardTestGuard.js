/**
 * Forward-test stop-regel.
 *
 * Actief als FORWARD_TEST=true in de omgeving.
 * Telt live doorgelaten signalen met uitkomst (tp/sl, niet 'geen').
 * Na ≥40 trades met negatieve verwachtingswaarde (na $0.70 kosten):
 *   → zet STOPPED=true, stuurt Discord-melding, logt elke nieuwe trigger maar
 *     retourneert { stopped: true } zodat scheduler de boardroom overslaat.
 *
 * Verwachtingswaarde-berekening: gemiddeld rMultiple - kosten_in_R
 * kosten_in_R = $0.70 / gemiddelde SL-afstand in dollars
 */

import { getAllSignals } from '../data/store.js';
import { config } from '../config/index.js';

const FORWARD_TEST = process.env.FORWARD_TEST === 'true';
const MIN_TRADES   = 40;
const COST_USD     = 0.70;

let _stopped = false;
let _alertSent = false;

export function isForwardTestStopped() {
  return FORWARD_TEST && _stopped;
}

// Bereken expectancy op basis van live doorgelaten signalen met rMultiple.
// Retourneert { trades, expectancyR, stopped } of null als FORWARD_TEST niet actief.
export async function evaluateForwardTest() {
  if (!FORWARD_TEST) return null;

  const signals = await getAllSignals();
  const resolved = signals.filter(
    (s) =>
      s.qualityResult?.passed === true &&
      s.outcome?.result &&
      ['tp', 'sl'].includes(s.outcome.result) &&
      s.outcome.rMultiple != null &&
      s.entryPrice != null &&
      s.decision?.stopLoss != null,
  );

  if (resolved.length < MIN_TRADES) return { trades: resolved.length, expectancyR: null, stopped: false };

  const slDists = resolved.map((s) => Math.abs(s.entryPrice - s.decision.stopLoss));
  const avgSlDist = slDists.reduce((a, b) => a + b, 0) / slDists.length;
  const costR = avgSlDist > 0 ? COST_USD / avgSlDist : 0;
  const sumR  = resolved.reduce((acc, s) => acc + s.outcome.rMultiple, 0);
  const expectancyR = +((sumR / resolved.length) - costR).toFixed(3);

  const shouldStop = expectancyR < 0;
  if (shouldStop && !_stopped) {
    _stopped = true;
    console.warn(
      `[forwardTestGuard] STOP: ${resolved.length} trades, E(R)=${expectancyR}R na kosten. ` +
      `Systeem stopt met nieuwe signalen.`,
    );
  }

  return { trades: resolved.length, expectancyR, stopped: shouldStop };
}

// Stuur Discord-melding bij activering stop-regel (eenmalig).
export async function sendStopAlert(discordClient) {
  if (!FORWARD_TEST || !_stopped || _alertSent) return;
  _alertSent = true;

  const result = await evaluateForwardTest();
  const msg =
    `⛔ **FORWARD-TEST GESTOPT**\n` +
    `Na ${result?.trades ?? '?'} trades is de verwachtingswaarde negatief ` +
    `(E(R) = ${result?.expectancyR ?? '?'}R na $${COST_USD} kosten per trade).\n` +
    `Het systeem genereert geen nieuwe signalen meer tot handmatige herstart.\n` +
    `Zet FORWARD_TEST=false of herstart met nieuwe parameters na grondige analyse.`;

  try {
    const { ceoChannelId } = config.boardroom;
    if (discordClient && ceoChannelId) {
      const channel = await discordClient.channels.fetch(ceoChannelId);
      await channel.send(msg);
    }
  } catch (err) {
    console.error('[forwardTestGuard] Discord-melding mislukt:', err.message);
  }
}
