import { getAllSignals } from '../data/store.js';

// Risicopercentage per positiegrootte (van account-kapitaal).
// Aanpassen aan je eigen account-instellingen voor FTMO-challenge.
const RISK_PCT = { klein: 0.5, normaal: 1.0, groot: 2.0 };

// FTMO Challenge Phase 1 limieten (conservatief):
export const DAILY_LOSS_LIMIT_PCT  = -5;   // max -5% van account per dag
export const TOTAL_DRAWDOWN_PCT    = -10;  // max -10% totale drawdown (FTMO hard rule)
export const DAILY_WARN_PCT        = -3;   // waarschuwing bij -3% vandaag

// R:R 2.0 = standaard (backtest-optimum); TP levert 2× risico op.
const RR = 2.0;

function riskPct(positionSize) {
  return RISK_PCT[positionSize] ?? RISK_PCT.normaal;
}

function pnlForSignal(signal) {
  const { outcome, decision } = signal;
  if (!outcome || !['tp', 'sl'].includes(outcome.result)) return null;
  const risk = riskPct(decision?.positionSize);
  return outcome.result === 'tp' ? risk * RR : -risk;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function getFtmoStats() {
  const all = await getAllSignals();
  const today = todayUtc();

  let todayPnL = 0;
  let totalPnL  = 0;
  let peakPnL   = 0;
  let maxDrawdown = 0;
  let todayTrades = 0;
  let totalTrades = 0;

  for (const s of all) {
    const pnl = pnlForSignal(s);
    if (pnl === null) continue;
    totalPnL += pnl;
    totalTrades++;
    if (totalPnL > peakPnL) peakPnL = totalPnL;
    const dd = totalPnL - peakPnL;
    if (dd < maxDrawdown) maxDrawdown = dd;

    const dayStr = s.timestamp.slice(0, 10);
    if (dayStr === today) {
      todayPnL += pnl;
      todayTrades++;
    }
  }

  return { todayPnL, totalPnL, maxDrawdown, todayTrades, totalTrades };
}

export async function checkFtmoLimits() {
  const stats = await getFtmoStats();
  const blockers = [];

  if (stats.todayPnL <= DAILY_LOSS_LIMIT_PCT) {
    blockers.push(`dagelijks verlies bereikt (${stats.todayPnL.toFixed(1)}% ≤ ${DAILY_LOSS_LIMIT_PCT}%)`);
  }
  if (stats.maxDrawdown <= TOTAL_DRAWDOWN_PCT) {
    blockers.push(`maximale drawdown bereikt (${stats.maxDrawdown.toFixed(1)}% ≤ ${TOTAL_DRAWDOWN_PCT}%)`);
  }

  const warnings = [];
  if (stats.todayPnL <= DAILY_WARN_PCT && stats.todayPnL > DAILY_LOSS_LIMIT_PCT) {
    warnings.push(`dag-verlies nadert limiet (${stats.todayPnL.toFixed(1)}% van ${DAILY_LOSS_LIMIT_PCT}% limiet)`);
  }

  return { blocked: blockers.length > 0, blockers, warnings, stats };
}

export function formatFtmoStatus(check) {
  const { stats, blocked, blockers, warnings } = check;
  const todayBar = progressBar(stats.todayPnL, DAILY_LOSS_LIMIT_PCT);
  const ddBar = progressBar(stats.maxDrawdown, TOTAL_DRAWDOWN_PCT);

  const statusIcon = blocked ? '🛑' : warnings.length > 0 ? '⚠️' : '✅';

  const lines = [
    `**${statusIcon} FTMO Risk Monitor**`,
    ``,
    `**Vandaag:** ${stats.todayPnL >= 0 ? '+' : ''}${stats.todayPnL.toFixed(1)}% (${stats.todayTrades} trades)`,
    `Daglimiet: ${todayBar} ${DAILY_LOSS_LIMIT_PCT}%`,
    ``,
    `**Totaal P&L:** ${stats.totalPnL >= 0 ? '+' : ''}${stats.totalPnL.toFixed(1)}% (${stats.totalTrades} trades)`,
    `Max drawdown: ${ddBar} ${TOTAL_DRAWDOWN_PCT}% limiet`,
  ];

  if (blocked) {
    lines.push(``, `🛑 **GEBLOKKEERD:** ${blockers.join(' | ')}`);
  } else if (warnings.length > 0) {
    lines.push(``, `⚠️ **Waarschuwing:** ${warnings.join(' | ')}`);
  } else {
    lines.push(``, `✅ Binnen limieten — handelen toegestaan`);
  }

  return lines.join('\n');
}

function progressBar(current, limit) {
  // Limiet is negatief (verlies). Current kan positief of negatief zijn.
  const pct = limit === 0 ? 0 : Math.min(1, Math.max(0, current / limit));
  const filled = Math.round(pct * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `[${bar}] ${(pct * 100).toFixed(0)}%`;
}
