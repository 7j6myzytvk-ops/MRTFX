import { config } from '../config/index.js';

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
  return (
    `Signaal: ${decision.signal.toUpperCase()} (zekerheid: ${decision.confidence}%)\n` +
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
  const { analyst, riskManager, devilsAdvocate, macro, analystRebuttal } = discussion;
  const ceoLine =
    `**👔 CEO - eindbeslissing - ${formatSetupMarker(decision.signal, comboSignal, qualityResult)}**\n` +
    formatDecisionBody(decision) +
    (!qualityResult.passed && qualityResult.blockers?.length > 0
      ? `\n⚠️ Niet geadviseerd: ${qualityResult.blockers.join(', ')}.`
      : '');

  return [
    `**🔍 Analist - eerste analyse**\nSignaal: ${analyst.signal.toUpperCase()} (zekerheid: ${analyst.confidence}%)\n${analyst.reasoning}`,
    `**🛡️ Risicomanager**\nSL: ${riskManager.stopLoss} | TP: ${riskManager.takeProfit} | Positiegrootte: ${riskManager.positionSize}\n${riskManager.reasoning}`,
    `**🗣️ Devil's Advocate**\nTegen-signaal: ${devilsAdvocate.counterSignal.toUpperCase()} (zekerheid: ${devilsAdvocate.counterConfidence}%)\n${devilsAdvocate.argument}`,
    `**🌍 Marktcontext/Sentiment**\nSentiment: ${macro.sentiment} (zekerheid: ${macro.confidence}%)\n${macro.reasoning}`,
    `**🔁 Analist - weerwoord**\nSignaal: ${analystRebuttal.signal.toUpperCase()} (zekerheid: ${analystRebuttal.confidence}%)\n${analystRebuttal.reasoning}`,
    ceoLine,
  ];
}

export async function reportToDiscord(client, result) {
  const { ceoChannelId, traceChannelId } = config.boardroom;
  const qualityResult = result.qualityResult ?? { passed: true, blockers: [] };

  if (traceChannelId) {
    const channel = await client.channels.fetch(traceChannelId);
    for (const msg of formatTraceMessages({ ...result, qualityResult })) {
      await channel.send(msg);
    }
  }

  if (ceoChannelId) {
    const channel = await client.channels.fetch(ceoChannelId);
    await channel.send(formatCeoMessage(result.decision, result.comboSignal, qualityResult));

    const alert = formatComboAlert(
      result.decision.signal,
      result.comboSignal,
      config.boardroom.alertUserId,
      qualityResult,
    );
    if (alert) await channel.send(alert);
  }
}

const OUTCOME_LABEL = {
  tp: '✅ Take-profit geraakt',
  sl: '❌ Stop-loss geraakt',
  geen: '➖ Geen TP/SL geraakt binnen de horizon',
};

export function formatOutcomeMessage({ id, timestamp, decision, outcome }) {
  const label = OUTCOME_LABEL[outcome.result] ?? outcome.result;
  const candlesNote = outcome.candlesToHit ? ` (na ${outcome.candlesToHit} candles)` : '';
  const entryTime = new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16);

  return (
    `**Signaal #${id} afgerond - ${label}${candlesNote}**\n` +
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
    await channel.send(formatOutcomeMessage(signal));
  }
}
