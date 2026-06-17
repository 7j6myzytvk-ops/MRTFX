import { computeTimeframeBias, computeMultiTFAlignment, computeTrendBias } from '../agents/multiTimeframeAlignment.js';
import { checkKeyLevelProximity } from '../agents/keyLevels.js';

// Sessiefilter: alleen actief tijdens London + NY overlap (08:00–17:00 UTC).
// Dit is de meest liquide periode voor XAU/USD — buiten deze uren is goud
// volatiel maar onvoorspelbaar (dunne markt, weinig institutionele deelname).
export function isActiveSession(now = new Date()) {
  const hour = now.getUTCHours();
  return hour >= 8 && hour < 17;
}

// Controleert alle vier voorwaarden voor een hoogwaardig setup-signaal.
// Geeft { triggered, direction, blockers, details } terug.
// Alleen als triggered=true is de boardroom het waard om samen te roepen.
export function checkConditions({
  h1Candles,
  m30Candles,
  m15Candles,
  d1Candles,
  w1Candles,
  now = new Date(),
} = {}) {
  const blockers = [];

  // 1. Sessiefilter (goedkoopste check — eerst uitvoeren)
  if (!isActiveSession(now)) {
    blockers.push('buiten actieve sessie (08:00–17:00 UTC)');
  }

  // 2. Multi-timeframe alignment (H1 + M30 + M15 moeten het eens zijn)
  const h1Bias = computeTimeframeBias(h1Candles);
  const m30Bias = computeTimeframeBias(m30Candles);
  const m15Bias = computeTimeframeBias(m15Candles);
  const tfAlignment = computeMultiTFAlignment(h1Bias, m30Bias, m15Bias);
  if (!tfAlignment.aligned) {
    blockers.push(`timeframes niet aligned (H1: ${h1Bias}, M30: ${m30Bias}, M15: ${m15Bias})`);
  }

  // 3. Trendfilter (D1 en W1 moeten dezelfde richting hebben)
  const trendBias = computeTrendBias(d1Candles, w1Candles);
  if (!trendBias.aligned) {
    blockers.push('D1/W1 trendrichting niet aligned');
  }

  // 4. Richtingsconsistentie (TF-alignment en trendfilter moeten dezelfde kant wijzen)
  if (tfAlignment.aligned && trendBias.aligned && tfAlignment.direction !== trendBias.direction) {
    blockers.push(
      `TF-richting (${tfAlignment.direction}) conflicteert met trendrichting (${trendBias.direction})`,
    );
  }

  // 5. Sleutelniveau-proximity (prijs moet nabij een wekelijks pivot of rond getal liggen)
  const nearLevel = checkKeyLevelProximity(h1Candles, w1Candles);
  if (!nearLevel.near) {
    blockers.push('prijs niet nabij een sleutelniveau');
  }

  const triggered = blockers.length === 0;
  const direction = tfAlignment.direction;

  return {
    triggered,
    direction,
    blockers,
    details: {
      session: isActiveSession(now),
      h1Bias,
      m30Bias,
      m15Bias,
      tfAlignment,
      trendBias,
      nearLevel,
    },
  };
}

// Formatteert de trigger-context als aanvullende noot voor de agents.
// Alle agents ontvangen dit als onderdeel van contextNotes zodat ze weten
// waarom de boardroom werd samengesteld — dit is een condition-based analyse.
export function formatConditionContext(conditions) {
  if (!conditions || !conditions.triggered) return '';
  const { direction, details } = conditions;
  const levelNote = details.nearLevel?.near
    ? ` nabij ${details.nearLevel.label} ($${details.nearLevel.level.toFixed(2)}, ${details.nearLevel.approachDirection})`
    : '';
  return (
    `\n\nAlgoritmische trigger: alle vier voorwaarden zijn voldaan. ` +
    `H1/M30/M15 zijn allen ${direction === 'bullish' ? 'bullish' : 'bearish'} aligned. ` +
    `D1- en W1-trendrichting: ${details.trendBias.direction}. ` +
    `Prijs bevindt zich${levelNote}. ` +
    `Dit is een condition-based setup-signaal, niet een tijdgebonden analyse — ` +
    `weeg dit mee bij je zekerheidspercentage.`
  );
}
