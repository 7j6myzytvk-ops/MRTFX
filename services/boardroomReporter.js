import { config } from '../config/index.js';

// Visuele markering of een CEO-besluit een "setup" is om naar te kijken
// (bullish/bearish) of dat er bewust geen positie wordt genomen (neutral).
const SETUP_MARKER = {
  bullish: '🚨 Setup gevonden',
  bearish: '🚨 Setup gevonden',
  neutral: '💤 Geen actie',
};

// Extra markering naast 🚨/💤: rebuttal-shift 'omhoog' + risk/reward '<1.5'
// (zie agents/agentAnalysis.js's isComboSignal) hangt in de backtests samen met
// een duidelijk hogere winRate. Alleen relevant bij een setup (niet bij 💤).
const COMBO_MARKER = ' 🌟';

export function formatSetupMarker(signal, comboSignal = false) {
  const base = SETUP_MARKER[signal];
  return signal !== 'neutral' && comboSignal ? `${base}${COMBO_MARKER}` : base;
}

function formatDecisionBody(decision) {
  return (
    `Signaal: ${decision.signal.toUpperCase()} (zekerheid: ${decision.confidence}%)\n` +
    `SL: ${decision.stopLoss} | TP: ${decision.takeProfit} | Positiegrootte: ${decision.positionSize}\n` +
    `${decision.reasoning}`
  );
}

export function formatCeoMessage(decision, comboSignal = false) {
  return `**👔 CEO-besluit - ${formatSetupMarker(decision.signal, comboSignal)}**\n${formatDecisionBody(decision)}`;
}

// Proactieve melding bovenop het CEO-bericht: alleen bij een combo-signaal
// (zie agents/agentAnalysis.js's isComboSignal) op een echte setup, en alleen
// als er een Discord user-ID is geconfigureerd om te pingen.
export function formatComboAlert(signal, comboSignal, alertUserId) {
  if (signal === 'neutral' || !comboSignal || !alertUserId) return null;
  return `🌟 <@${alertUserId}> Combo-signaal gedetecteerd - bekijk het CEO-besluit hierboven!`;
}

export function formatTraceMessages({ discussion, decision, comboSignal = false }) {
  const { analyst, riskManager, devilsAdvocate, macro, analystRebuttal } = discussion;

  return [
    `**🔍 Analist - eerste analyse**\nSignaal: ${analyst.signal.toUpperCase()} (zekerheid: ${analyst.confidence}%)\n${analyst.reasoning}`,
    `**🛡️ Risicomanager**\nSL: ${riskManager.stopLoss} | TP: ${riskManager.takeProfit} | Positiegrootte: ${riskManager.positionSize}\n${riskManager.reasoning}`,
    `**🗣️ Devil's Advocate**\nTegen-signaal: ${devilsAdvocate.counterSignal.toUpperCase()} (zekerheid: ${devilsAdvocate.counterConfidence}%)\n${devilsAdvocate.argument}`,
    `**🌍 Marktcontext/Sentiment**\nSentiment: ${macro.sentiment} (zekerheid: ${macro.confidence}%)\n${macro.reasoning}`,
    `**🔁 Analist - weerwoord**\nSignaal: ${analystRebuttal.signal.toUpperCase()} (zekerheid: ${analystRebuttal.confidence}%)\n${analystRebuttal.reasoning}`,
    `**👔 CEO - eindbeslissing - ${formatSetupMarker(decision.signal, comboSignal)}**\n${formatDecisionBody(decision)}`,
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
    await channel.send(formatCeoMessage(result.decision, result.comboSignal));

    const alert = formatComboAlert(result.decision.signal, result.comboSignal, config.boardroom.alertUserId);
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
