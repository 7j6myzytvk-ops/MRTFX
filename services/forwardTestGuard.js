/**
 * Forward-test stop-regel.
 *
 * Actief als FORWARD_TEST=true in de omgeving.
 * Telt doorgelaten signalen met uitkomst (tp/sl/geen) vanaf FORWARD_TEST_START
 * (ISO-datum in env, bijv. "2026-11-25"). Signalen vóór die datum worden genegeerd.
 * Na ≥40 trades met negatieve verwachtingswaarde (na $0.70 kosten):
 *   → zet STOPPED=true, stuurt Discord-melding, retourneert { stopped: true }
 *     zodat scheduler de boardroom overslaat.
 *
 * Verwachtingswaarde: gemiddeld rMultiple over alle uitkomsten (tp/sl/geen) − kosten_in_R
 * kosten_in_R = $0.70 / gemiddelde SL-afstand in dollars
 * 'geen'-uitkomsten tellen mee: hun rMultiple is typisch klein positief of nul
 * en hoort in de verwachtingswaarde.
 */

import { getAllSignals } from '../data/store.js';
import { config } from '../config/index.js';

const FORWARD_TEST       = process.env.FORWARD_TEST === 'true';
const FORWARD_TEST_START = process.env.FORWARD_TEST_START ?? null;   // ISO-datum of null = alle data
const MIN_TRADES         = 40;
const COST_USD           = 0.70;

let _stopped   = false;
let _alertSent = false;

export function isForwardTestStopped() {
  return FORWARD_TEST && _stopped;
}

// Bereken expectancy op basis van live doorgelaten signalen met rMultiple.
// Retourneert { trades, expectancyR, stopped } of null als FORWARD_TEST niet actief.
export async function evaluateForwardTest() {
  if (!FORWARD_TEST) return null;

  const startCutoff = FORWARD_TEST_START ? new Date(FORWARD_TEST_START).getTime() : 0;

  const signals = await getAllSignals();
  const resolved = signals.filter(
    (s) =>
      s.onbruikbaar !== true &&          // uitzondering: handmatig gemarkeerde ongeldige signalen
      s.qualityResult?.passed === true &&
      s.outcome?.result &&
      ['tp', 'sl', 'geen'].includes(s.outcome.result) &&
      s.outcome.rMultiple != null &&
      s.entryPrice != null &&
      s.decision?.stopLoss != null &&
      new Date(s.timestamp).getTime() >= startCutoff,
  );

  if (resolved.length < MIN_TRADES) return { trades: resolved.length, expectancyR: null, stopped: false };

  const slDists    = resolved.map((s) => Math.abs(s.entryPrice - s.decision.stopLoss));
  const avgSlDist  = slDists.reduce((a, b) => a + b, 0) / slDists.length;
  const costR      = avgSlDist > 0 ? COST_USD / avgSlDist : 0;
  const sumR       = resolved.reduce((acc, s) => acc + s.outcome.rMultiple, 0);
  const expectancyR = +((sumR / resolved.length) - costR).toFixed(3);

  const shouldStop = expectancyR < 0;
  if (shouldStop && !_stopped) {
    _stopped = true;
    console.warn(
      `[forwardTestGuard] STOP: ${resolved.length} trades vanaf ${FORWARD_TEST_START ?? 'begin'}, ` +
      `E(R)=${expectancyR}R na kosten. Systeem stopt met nieuwe signalen.`,
    );
  }

  return { trades: resolved.length, expectancyR, stopped: shouldStop };
}

// Stuur Discord-melding bij activering stop-regel (eenmalig).
export async function sendStopAlert(discordClient) {
  if (!FORWARD_TEST || !_stopped || _alertSent) return;
  _alertSent = true;

  const result = await evaluateForwardTest();
  const startNote = FORWARD_TEST_START ? ` (vanaf ${FORWARD_TEST_START})` : '';
  const msg =
    `⛔ **FORWARD-TEST GESTOPT**\n` +
    `Na ${result?.trades ?? '?'} trades${startNote} is de verwachtingswaarde negatief ` +
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
