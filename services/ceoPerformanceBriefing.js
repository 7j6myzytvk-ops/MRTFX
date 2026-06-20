import { readFile } from 'fs/promises';
import path from 'path';

const SIGNALS_FILE = path.join(process.cwd(), 'data', 'signals.json');
const MAX_RECENT = 10;

async function readRecentSignals() {
  try {
    const raw = await readFile(SIGNALS_FILE, 'utf-8');
    const signals = JSON.parse(raw);
    return signals
      .filter((s) => s.outcome && ['tp', 'sl', 'geen'].includes(s.outcome.result))
      .slice(-MAX_RECENT);
  } catch {
    return [];
  }
}

// Pure functies — exporteer apart zodat ze unit-testbaar zijn zonder bestandsaccess.

export function computeStreak(signals) {
  if (!signals.length) return { type: null, count: 0 };
  const lastResult = signals[signals.length - 1].outcome.result;
  let count = 0;
  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i].outcome.result === lastResult) count++;
    else break;
  }
  return { type: lastResult, count };
}

export function computeBriefingStats(signals) {
  if (!signals.length) return null;
  const tp = signals.filter((s) => s.outcome.result === 'tp').length;
  const sl = signals.filter((s) => s.outcome.result === 'sl').length;
  const geen = signals.filter((s) => s.outcome.result === 'geen').length;
  const trades = tp + sl + geen;
  const winRate = trades > 0 ? Math.round((tp / (tp + sl)) * 100) : null;
  const streak = computeStreak(signals);
  return { n: signals.length, tp, sl, geen, winRate, streak };
}

export async function getCeoPerformanceBriefing() {
  const recent = await readRecentSignals();
  return computeBriefingStats(recent);
}

export function formatCeoPerformanceBriefingNote(stats) {
  if (!stats) return '';

  const { n, tp, sl, winRate, streak } = stats;

  const wrNote =
    winRate === null
      ? `Winrate onbekend (geen afgeronde TP/SL-trades).`
      : winRate < 40
        ? `Recente winRate: ${winRate}% — ruim onder doelstelling. Wees selectiever, verhoog je eigen drempel.`
        : winRate > 65
          ? `Recente winRate: ${winRate}% — boven verwachting.`
          : `Recente winRate: ${winRate}%.`;

  let streakMsg = '';
  if (streak.count >= 3) {
    if (streak.type === 'sl') {
      streakMsg =
        `\n⚠️ REEKS-ALERT: ${streak.count}× achtereen SL. ` +
        `Verhoog je drempel — handhaaf neutraal tenzij alle stemmen onomwonden dezelfde kant wijzen.`;
    } else if (streak.type === 'tp') {
      streakMsg =
        `\nReeks: ${streak.count}× achtereen TP. ` +
        `Momentum aanwezig — maar laat dit je drempel niet verlagen. Behoud discipline.`;
    }
  }

  return (
    `\n\nCHIEF OF STAFF — PRE-VERGADERING PERFORMANCE BRIEFING:\n` +
    `Laatste ${n} afgeronde signalen: ${tp} TP / ${sl} SL. ${wrNote}${streakMsg}\n` +
    `Gebruik dit als tiebreaker bij twijfel — laat het je analyse niet vervangen.`
  );
}

export function formatRiskStreakNote(stats) {
  if (!stats || stats.streak.count < 3 || stats.streak.type !== 'sl') return '';
  return (
    `\n\nREEKS-CONTEXT (voor positiegrootte): huidige verliesreeks is ${stats.streak.count}× SL. ` +
    `Standaard naar 'klein', ongeacht het zekerheidspercentage — ` +
    `totdat de reeks doorbroken is met een bevestigde TP.`
  );
}
