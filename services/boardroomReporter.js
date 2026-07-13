import { config } from '../config/index.js';

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

export function formatCeoMessage(decision, comboSignal = false, qualityResult = { passed: true, blockers: [] }) {
  const marker = formatSetupMarker(decision.signal, comboSignal, qualityResult);
  let msg = `**👔 CEO-besluit - ${marker}**\n${formatDecisionBody(decision)}`;
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

  if (effectiveTraceChannelId) {
    const channel = await client.channels.fetch(effectiveTraceChannelId);
    for (const msg of formatTraceMessages({ ...result, qualityResult })) {
      await channel.send(truncateForDiscord(msg));
    }
  }

  if (effectiveCeoChannelId) {
    const channel = await client.channels.fetch(effectiveCeoChannelId);
    await channel.send(truncateForDiscord(formatCeoMessage(result.decision, result.comboSignal, qualityResult)));

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
