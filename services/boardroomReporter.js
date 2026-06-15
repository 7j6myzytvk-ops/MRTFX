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
