import { config } from '../config/index.js';

// Berekent de exacte lot size op basis van accountsaldo, risico% en SL-afstand.
// positionSize (klein/normaal/groot) schaalt het risico: 0.5× / 1× / 1.5×.
// OANDA XAU/USD: 1 lot = 100 oz → $1 move = $100 P&L per lot.
function computeLotSize(result) {
  const accountEur = config.trading?.accountBalanceEur;
  const baseRiskPct = config.trading?.riskPct ?? 3;
  if (!accountEur || result.decision?.signal === 'neutral') return null;

  const { stopLoss, positionSize } = result.decision;
  const entryPrice = result.entryPrice;
  const eurUsdRate = result.eurUsdRate ?? 1.08;
  if (!stopLoss || !entryPrice) return null;

  const sizeMultiplier = positionSize === 'klein' ? 0.5 : positionSize === 'groot' ? 1.5 : 1.0;
  const riskPct = baseRiskPct * sizeMultiplier;
  const riskEur = accountEur * (riskPct / 100);
  const riskUsd = riskEur * eurUsdRate;
  const slDistance = Math.abs(entryPrice - stopLoss);
  if (slDistance === 0) return null;

  const rawLots = riskUsd / (slDistance * 100);
  const roundedLots = Math.max(0.001, Math.round(rawLots / 0.001) * 0.001);
  return {
    lots: roundedLots.toFixed(3),
    riskEur: Math.round(riskEur),
    riskPct: riskPct.toFixed(1),
    slDistance: slDistance.toFixed(1),
  };
}

// Discord staat maximaal 2000 tekens per berichtinhoud toe. CEO-reasoning kan
// dat overschrijden (gezien tijdens live gebruik) - zonder deze guard crasht
// de hele poll-cyclus op een 'Invalid Form Body'-fout en wordt het signaal
// niet eens naar Discord gemeld (al staat het al wel opgeslagen, zie
// agents/boardroom.js's appendSignal-volgorde).
const DISCORD_MAX_LENGTH = 2000;
const TRUNCATE_SUFFIX = '\n… (afgekapt, bericht was te lang voor Discord)';

function truncateForDiscord(text) {
  if (text.length <= DISCORD_MAX_LENGTH) return text;
  return text.slice(0, DISCORD_MAX_LENGTH - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
}

// Visuele markering op basis van signaalrichting en kwaliteitsfilter:
// - 🚨 Setup gevonden   → setup die alle kwaliteitsfilters passeert
// - 🔶 Setup (gefilterd) → setup die minstens één kwaliteitsfilter niet haalt
// - 💤 Geen actie       → CEO neemt bewust geen positie
// Combo-markering 🌟 wordt alleen toegevoegd als het kwaliteitsfilter is gepasseerd.
export function formatSetupMarker(signal, comboSignal = false, qualityResult = { passed: true }) {
  if (signal === 'neutral') return '💤 Geen actie';
  if (!qualityResult.passed) return '🔶 Setup (gefilterd)';
  return comboSignal ? '🚨 Setup gevonden 🌟' : '🚨 Setup gevonden';
}

function formatDecisionBody(decision) {
  const entryLine = decision.entryZone ? `Entry: ${decision.entryZone}\n` : '';
  return (
    `Signaal: ${decision.signal.toUpperCase()} (zekerheid: ${decision.confidence}%)\n` +
    `${entryLine}` +
    `SL: ${decision.stopLoss} | TP: ${decision.takeProfit} | Positiegrootte: ${decision.positionSize}\n` +
    `${decision.reasoning}`
  );
}

function computeAlertContext(result) {
  const setupScore = result.discussion?.analyst?.setupQualityScore ?? null;
  const entryPrice = result.entryPrice;
  const { stopLoss, takeProfit } = result.decision;
  let rr = null;
  if (entryPrice && stopLoss && takeProfit) {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    if (risk > 0) rr = (reward / risk).toFixed(1);
  }
  const now = new Date();
  const sessionEnd = new Date(now);
  sessionEnd.setUTCHours(17, 0, 0, 0);
  const minutesLeft = Math.floor((sessionEnd - now) / 60000);
  const sessionNote = minutesLeft > 0 ? `${minutesLeft} min` : null;
  const lotSize = computeLotSize(result);
  return { setupScore, rr, sessionNote, lotSize };
}

export function formatCeoMessage(decision, comboSignal = false, qualityResult = { passed: true, blockers: [] }, context = {}) {
  const marker = formatSetupMarker(decision.signal, comboSignal, qualityResult);
  const { setupScore, rr, sessionNote, lotSize } = context;
  const metaParts = [];
  if (setupScore != null) metaParts.push(`Setup: ${setupScore}/6`);
  if (rr != null) metaParts.push(`R:R: ${rr}`);
  if (sessionNote) metaParts.push(`Sessie: nog ${sessionNote}`);
  if (lotSize) metaParts.push(`Lot: ${lotSize.lots} (€${lotSize.riskEur} = ${lotSize.riskPct}% | SL $${lotSize.slDistance})`);
  const metaLine = metaParts.length ? metaParts.join(' | ') + '\n' : '';
  let msg = `**👔 CEO-besluit - ${marker}**\n${metaLine}${formatDecisionBody(decision)}`;
  if (!qualityResult.passed && qualityResult.blockers?.length > 0) {
    msg += `\n⚠️ Niet geadviseerd: ${qualityResult.blockers.join(', ')}.`;
  }
  return msg;
}

// Proactieve melding bovenop het CEO-bericht: alleen bij een combo-signaal
// dat ook het kwaliteitsfilter passeert. Gefilterde signalen krijgen geen ping.
export function formatComboAlert(signal, comboSignal, alertUserId, qualityResult = { passed: true }) {
  if (signal === 'neutral' || !comboSignal || !alertUserId) return null;
  if (!qualityResult.passed) return null;
  return `🌟 <@${alertUserId}> Combo-signaal gedetecteerd - bekijk het CEO-besluit hierboven!`;
}

export function formatTraceMessages({
  discussion,
  decision,
  comboSignal = false,
  qualityResult = { passed: true, blockers: [] },
}) {
  const { analyst, riskManager, devilsAdvocate, macro, geopolitical, analystRebuttal } = discussion;
  const ceoLine =
    `**👔 CEO - eindbeslissing - ${formatSetupMarker(decision.signal, comboSignal, qualityResult)}**\n` +
    formatDecisionBody(decision) +
    (!qualityResult.passed && qualityResult.blockers?.length > 0
      ? `\n⚠️ Niet geadviseerd: ${qualityResult.blockers.join(', ')}.`
      : '');

  const messages = [
    `**🔍 Analist - eerste analyse**\nSignaal: ${analyst.signal.toUpperCase()} (zekerheid: ${analyst.confidence}%) | AMD-fase: ${analyst.amdPhase ?? 'onbekend'}\n${analyst.reasoning}`,
    `**🛡️ Risicomanager**\nSL: ${riskManager.stopLoss} | TP: ${riskManager.takeProfit} | Positiegrootte: ${riskManager.positionSize}\n${riskManager.reasoning}`,
    `**🗣️ Devil's Advocate**\nTegen-signaal: ${devilsAdvocate.counterSignal.toUpperCase()} (zekerheid: ${devilsAdvocate.counterConfidence}%)\n${devilsAdvocate.argument}`,
    `**🌍 Marktcontext/Sentiment**\nSentiment: ${macro.sentiment} (zekerheid: ${macro.confidence}%)\n${macro.reasoning}`,
  ];

  if (geopolitical && geopolitical.confidence > 0) {
    const keyEventsNote = geopolitical.keyEvents?.length
      ? `\nSleutel-events: ${geopolitical.keyEvents.join('; ')}`
      : '';
    const decayNote = geopolitical.sellTheNewsRisk && geopolitical.sellTheNewsRisk !== 'n.v.t.'
      ? `\n"Sell the news"-risico: ${geopolitical.sellTheNewsRisk}`
      : '';
    messages.push(
      `**📰 Geopolitieke/nieuws-analyse**\nOordeel: ${geopolitical.assessment} (zekerheid: ${geopolitical.confidence}%)${decayNote}\n${geopolitical.reasoning}${keyEventsNote}`,
    );
  }

  messages.push(
    `**🔁 Analist - weerwoord**\nSignaal: ${analystRebuttal.signal.toUpperCase()} (zekerheid: ${analystRebuttal.confidence}%)\n${analystRebuttal.reasoning}`,
    ceoLine,
  );

  return messages;
}

export async function reportToDiscord(client, result, { ceoChannelId, traceChannelId } = {}) {
  const effectiveCeoChannelId = ceoChannelId ?? config.boardroom.ceoChannelId;
  const effectiveTraceChannelId = traceChannelId ?? config.boardroom.traceChannelId;
  const qualityResult = result.qualityResult ?? { passed: true, blockers: [] };
  const alertContext = computeAlertContext(result);

  if (effectiveTraceChannelId) {
    const channel = await client.channels.fetch(effectiveTraceChannelId);
    for (const msg of formatTraceMessages({ ...result, qualityResult })) {
      await channel.send(truncateForDiscord(msg));
    }
  }

  if (effectiveCeoChannelId) {
    const channel = await client.channels.fetch(effectiveCeoChannelId);
    await channel.send(truncateForDiscord(formatCeoMessage(result.decision, result.comboSignal, qualityResult, alertContext)));

    const alert = formatComboAlert(
      result.decision.signal,
      result.comboSignal,
      config.boardroom.alertUserId,
      qualityResult,
    );
    if (alert) await channel.send(truncateForDiscord(alert));
  }
}

const OUTCOME_LABEL = {
  tp: '✅ Take-profit geraakt',
  sl: '❌ Stop-loss geraakt',
  geen: '➖ Geen TP/SL geraakt binnen de horizon',
};

export function formatOutcomeMessage({ id, timestamp, decision, outcome, qualityResult }) {
  const label = OUTCOME_LABEL[outcome.result] ?? outcome.result;
  const candlesNote = outcome.candlesToHit ? ` (na ${outcome.candlesToHit} candles)` : '';
  const entryTime = new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16);
  const filteredNote = qualityResult?.passed === false ? ' *(gefilterd)*' : '';

  return (
    `**Signaal #${id} afgerond${filteredNote} - ${label}${candlesNote}**\n` +
    `Origineel signaal (${entryTime} UTC): ${decision.signal.toUpperCase()} ` +
    `(zekerheid ${decision.confidence}%) - SL ${decision.stopLoss} / TP ${decision.takeProfit} ` +
    `(${decision.positionSize})`
  );
}

export async function reportOutcomes(client, resolved) {
  const { ceoChannelId } = config.boardroom;
  if (!ceoChannelId || resolved.length === 0) return;

  const channel = await client.channels.fetch(ceoChannelId);
  for (const signal of resolved) {
    await channel.send(truncateForDiscord(formatOutcomeMessage(signal)));
  }
}

export { truncateForDiscord };
