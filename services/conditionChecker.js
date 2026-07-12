import { computeTimeframeBias, computeMultiTFAlignment, computeTrendBias } from '../agents/multiTimeframeAlignment.js';
import { checkKeyLevelProximity } from '../agents/keyLevels.js';

// Sessiefilter: actief 13:00–17:00 UTC (NY open en London/NY overlap).
// 1-jaar backtest (208 triggers, jul 2025–jul 2026): London-ochtend (09:00–12:00 UTC)
// heeft 25–40% WR door manipulation-fase. Pas vanaf 13:00 UTC krijg je echte institutionele
// orderflow: 13:00=46%, 14:00=50%, 15:00=50% WR. Zie Fase 50.
export function isActiveSession(now = new Date()) {
  const hour = now.getUTCHours();
  return hour >= 13 && hour < 17;
}

// Dagfilter: maandag heeft de laagste WR (40.9%) van alle weekdagen.
// Oorzaak: gap-risico van weekend, institutionelen orienteren zich nog,
// dunne orderflow in de eerste handelsuren van de week. Zie Fase 51.
export function isActiveDay(now = new Date()) {
  return now.getUTCDay() !== 1; // 1 = maandag
}

// Controleert drie harde voorwaarden voor een setup-signaal.
// nearLevel is een zachte voorkeur: wordt meegegeven als context aan agents,
// maar blokkeert de trigger niet (diagnose toonde 93.4% blokkade door nearLevel).
// Geeft { triggered, direction, blockers, details } terug.
export function checkConditions({
  h1Candles,
  m30Candles,
  m15Candles,
  d1Candles,
  w1Candles,
  now = new Date(),
} = {}) {
  const blockers = [];

  // 0. Dagfilter — maandag blokkeren (WR 40.9%, Fase 51)
  if (!isActiveDay(now)) {
    blockers.push('maandag uitgesloten (WR 40.9% in 1-jaar backtest)');
  }

  // 1. Sessiefilter (goedkoopste check — eerst uitvoeren)
  if (!isActiveSession(now)) {
    blockers.push('buiten actieve sessie (13:00–17:00 UTC)');
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

  // 5. Sleutelniveau-proximity — zachte voorkeur, geen harde blokkade.
  // Agents ontvangen dit als context en wegen het mee in hun setupQualityScore.
  const nearLevel = checkKeyLevelProximity(h1Candles, w1Candles);

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
    ? `Prijs bevindt zich nabij ${details.nearLevel.label} ($${details.nearLevel.level.toFixed(2)}, ${details.nearLevel.approachDirection}) — verhoogt setup-kwaliteit.`
    : `Prijs bevindt zich NIET nabij een gekend sleutelniveau — weeg dit mee in je setupQualityScore (verlaagt kwaliteit).`;
  return (
    `\n\nAlgoritmische trigger: drie harde voorwaarden zijn voldaan. ` +
    `H1/M30/M15 zijn allen ${direction === 'bullish' ? 'bullish' : 'bearish'} aligned. ` +
    `D1- en W1-trendrichting: ${details.trendBias.direction}. ` +
    `${levelNote} ` +
    `Dit is een condition-based setup-signaal, niet een tijdgebonden analyse — ` +
    `weeg dit mee bij je zekerheidspercentage.`
  );
}
