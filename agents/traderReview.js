import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `Je bent een veteraan XAU/USD forex-trader met meer dan 100.000 voltooide trades. \
Je hebt meerdere marktcycli overleefd — bull runs, bear markets, flash crashes, CPI-shocks, Fed-pivots. \
Je werkt uitsluitend vanuit het ICT/SMC-framework: Kill Zones, Order Blocks, BOS/CHoCH, Premium/Discount, AMD.

Je reviewt dagelijks het MRTFX-systeem: een geautomatiseerde XAU/USD setup-detector met een 6-agent boardroom. \
Je bent geen ontwikkelaar — je schrijft geen code. Je bent een mentor die op afstand meekijkt.

Schrijfstijl: direct, geen complimenten, geen pluimen, geen uitleg over jezelf. \
Begin onmiddellijk met de review. Maximaal 1400 tekens. Schrijf in het Nederlands.

Verdictschaal:
🟢 GROEN — systeem gedraagt zich correct voor de marktomgeving, geen actie nodig
🟡 GEEL — er is iets dat aandacht verdient, houd het in de gaten
🔴 ROOD — actie vereist, geef aan wat en waarom`;

const DAY_NAMES = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

export function buildReviewPrompt(ctx) {
  const {
    dateStr,
    dayName,
    sessionPolls,
    triggered,
    boardroomRuns,
    passed,
    filtered,
    neutral,
    dominantBlockers,
    signalLines,
    ftmoToday,
    ftmoTotal,
    ftmoDrawdown,
    ftmoTrades,
    recentVideos,
    weekAdvisedCount,
    weekTp,
    weekSl,
    weekWr,
  } = ctx;

  const blockerText = dominantBlockers.length > 0
    ? dominantBlockers.map(([b, n]) => `${b} (${n}×)`).join(', ')
    : 'geen';

  const signalText = signalLines.length > 0
    ? signalLines.join('\n')
    : 'Geen boardroom-signalen vandaag.';

  const videoText = recentVideos && recentVideos.length > 0
    ? recentVideos.map((v) => `• "${v.title}" (${v.channel}, ${v.published?.slice(0, 10) ?? '?'})`).join('\n')
    : null;

  const weekLine = weekAdvisedCount != null
    ? `Week t/m vandaag: ${weekAdvisedCount} geadviseerde signalen | TP: ${weekTp ?? 0} / SL: ${weekSl ?? 0}` +
      (weekWr != null ? ` → WR ${weekWr}%` : ' (geen afgeronde trades)') + '\n'
    : '';

  return (
    `DAGRAPPORT ${dateStr} (${dayName})\n` +
    `Sessie 13:00–17:00 UTC: ${sessionPolls} polls | ${triggered} condition-triggers | ${boardroomRuns} boardroom-runs\n` +
    `Boardroom-uitkomsten: ${passed} geadviseerd | ${filtered} gefilterd | ${neutral} neutraal\n` +
    `\n` +
    `Dominante blokkers: ${blockerText}\n` +
    `\n` +
    `Signalen:\n${signalText}\n` +
    `\n` +
    weekLine +
    `FTMO vandaag: ${ftmoToday >= 0 ? '+' : ''}${ftmoToday.toFixed(1)}% (${ftmoTrades} trades) | ` +
    `totaal: ${ftmoTotal >= 0 ? '+' : ''}${ftmoTotal.toFixed(1)}% | drawdown: ${ftmoDrawdown.toFixed(1)}%\n` +
    (videoText ? `\nRecente YouTube-video's (ter context, niet als handelssignaal):\n${videoText}\n` : '') +
    `\n` +
    `Geef je review in dit formaat:\n` +
    `**Sessie:** [wat de cijfers vertellen]\n` +
    `**Observatie:** [jouw concrete bevinding als ICT-trader]\n` +
    `**Morgen:** [wat ze in de gaten moeten houden]\n` +
    `**Verdict:** 🟢 GROEN / 🟡 GEEL / 🔴 ROOD`
  );
}

export async function runTraderReview(ctx) {
  const prompt = buildReviewPrompt(ctx);
  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
  return message.content[0]?.text ?? '(geen review gegenereerd)';
}

export { DAY_NAMES };
