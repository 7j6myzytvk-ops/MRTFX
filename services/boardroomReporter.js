import { config } from '../config/index.js';

function formatDecisionBody(decision) {
  return (
    `Signaal: ${decision.signal.toUpperCase()} (zekerheid: ${decision.confidence}%)\n` +
    `SL: ${decision.stopLoss} | TP: ${decision.takeProfit} | Positiegrootte: ${decision.positionSize}\n` +
    `${decision.reasoning}`
  );
}

export function formatCeoMessage(decision) {
  return `**👔 CEO-besluit**\n${formatDecisionBody(decision)}`;
}

export function formatTraceMessages({ discussion, decision }) {
  const { analyst, riskManager, devilsAdvocate, macro, analystRebuttal } = discussion;

  return [
    `**🔍 Analist - eerste analyse**\nSignaal: ${analyst.signal.toUpperCase()} (zekerheid: ${analyst.confidence}%)\n${analyst.reasoning}`,
    `**🛡️ Risicomanager**\nSL: ${riskManager.stopLoss} | TP: ${riskManager.takeProfit} | Positiegrootte: ${riskManager.positionSize}\n${riskManager.reasoning}`,
    `**🗣️ Devil's Advocate**\nTegen-signaal: ${devilsAdvocate.counterSignal.toUpperCase()} (zekerheid: ${devilsAdvocate.counterConfidence}%)\n${devilsAdvocate.argument}`,
    `**🌍 Marktcontext/Sentiment**\nSentiment: ${macro.sentiment} (zekerheid: ${macro.confidence}%)\n${macro.reasoning}`,
    `**🔁 Analist - weerwoord**\nSignaal: ${analystRebuttal.signal.toUpperCase()} (zekerheid: ${analystRebuttal.confidence}%)\n${analystRebuttal.reasoning}`,
    `**👔 CEO - eindbeslissing**\n${formatDecisionBody(decision)}`,
  ];
}

export async function reportToDiscord(client, result) {
  const { ceoChannelId, traceChannelId } = config.boardroom;

  if (traceChannelId) {
    const channel = await client.channels.fetch(traceChannelId);
    for (const msg of formatTraceMessages(result)) {
      await channel.send(msg);
    }
  }

  if (ceoChannelId) {
    const channel = await client.channels.fetch(ceoChannelId);
    await channel.send(formatCeoMessage(result.decision));
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
