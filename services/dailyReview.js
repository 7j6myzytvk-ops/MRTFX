import { config } from '../config/index.js';
import { getAllSignals } from '../data/store.js';
import { getConditionLog, filterConditionLog, summarizeConditionLog } from './conditionDiagnostics.js';
import { getFtmoStats } from './ftmoGuard.js';
import { runTraderReview, DAY_NAMES } from '../agents/traderReview.js';
import { truncateForDiscord } from './boardroomReporter.js';
import { getRecentVideos } from './youtubeMonitor.js';

function todayUtcRange() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  return {
    dateStr,
    dayName: DAY_NAMES[now.getUTCDay()],
    from: `${dateStr}T00:00:00.000Z`,
    to: `${dateStr}T23:59:59.999Z`,
    sessionFrom: `${dateStr}T08:00:00.000Z`,
    sessionTo: `${dateStr}T17:00:00.000Z`,
  };
}

function formatSignalLine(s) {
  const time = s.timestamp.slice(11, 16) + ' UTC';
  const dir = s.decision?.signal?.toUpperCase() ?? '?';
  const conf = s.decision?.confidence ?? '?';
  const score = s.discussion?.analyst?.setupQualityScore;
  const scoreStr = score != null ? ` | score ${score}/6` : '';
  const status = s.qualityResult?.passed === false
    ? `gefilterd (${(s.qualityResult.blockers ?? []).slice(0, 1).join(', ')})`
    : s.decision?.signal === 'neutral' ? 'neutraal' : 'geadviseerd';
  const outcome = s.outcome?.result && s.outcome.result !== 'open'
    ? ` → ${s.outcome.result.toUpperCase()}`
    : '';
  return `• ${time} ${dir} ${conf}%${scoreStr} — ${status}${outcome}`;
}

export async function runDailyReview(client) {
  const channelId = config.boardroom.dagrapportChannelId;
  if (!channelId) {
    console.warn('[dailyReview] DISCORD_DAGRAPPORT_CHANNEL_ID niet ingesteld — review overgeslagen.');
    return;
  }

  const { dateStr, dayName, from, to, sessionFrom, sessionTo } = todayUtcRange();

  // Signalen van vandaag
  const allSignals = await getAllSignals();
  const todaySignals = allSignals.filter((s) => s.timestamp >= from && s.timestamp <= to);
  const boardroomRuns = todaySignals.length;
  const passed = todaySignals.filter((s) => s.qualityResult?.passed !== false && s.decision?.signal !== 'neutral').length;
  const filtered = todaySignals.filter((s) => s.qualityResult?.passed === false).length;
  const neutral = todaySignals.filter((s) => s.decision?.signal === 'neutral').length;
  const signalLines = todaySignals.map(formatSignalLine);

  // Conditie-log voor de sessie
  const allLog = await getConditionLog();
  const sessionLog = filterConditionLog(allLog, { from: sessionFrom, to: sessionTo });
  const logSummary = summarizeConditionLog(sessionLog);
  const sessionPolls = logSummary.n;
  const triggered = logSummary.triggered;

  // Top-3 blokkers
  const blockerEntries = Object.entries(logSummary.blockerCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // FTMO
  const ftmoStats = await getFtmoStats();

  // Recente YouTube-video's (laatste 7 dagen) als extra marktcontext
  const recentVideos = await getRecentVideos(7).catch(() => []);

  // Weekcontext: geef de reviewer longitudinaal perspectief
  const now2 = new Date();
  const daysFromMonday = now2.getUTCDay() === 0 ? 6 : now2.getUTCDay() - 1;
  const monday = new Date(now2);
  monday.setUTCDate(now2.getUTCDate() - daysFromMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const weekSignals = allSignals.filter((s) => s.timestamp && s.timestamp >= monday.toISOString());
  const weekAdvised = weekSignals.filter((s) => s.qualityResult?.passed !== false && s.decision?.signal !== 'neutral');
  const weekTp = weekAdvised.filter((s) => s.outcome?.result === 'tp').length;
  const weekSl = weekAdvised.filter((s) => s.outcome?.result === 'sl').length;
  const weekWr = (weekTp + weekSl) > 0 ? Math.round((weekTp / (weekTp + weekSl)) * 100) : null;

  const ctx = {
    dateStr,
    dayName,
    sessionPolls,
    triggered,
    boardroomRuns,
    passed,
    filtered,
    neutral,
    dominantBlockers: blockerEntries,
    signalLines,
    ftmoToday: ftmoStats.todayPnL,
    ftmoTotal: ftmoStats.totalPnL,
    ftmoDrawdown: ftmoStats.maxDrawdown,
    ftmoTrades: ftmoStats.todayTrades,
    recentVideos,
    weekAdvisedCount: weekAdvised.length,
    weekTp,
    weekSl,
    weekWr,
  };

  const review = await runTraderReview(ctx);

  const channel = await client.channels.fetch(channelId);
  await channel.send(truncateForDiscord(`**📋 Dagrapport ${dateStr}**\n\n${review}`));

  console.log(`[dailyReview] Rapport verstuurd voor ${dateStr}.`);
}
