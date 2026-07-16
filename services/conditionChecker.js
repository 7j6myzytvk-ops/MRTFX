import { computeTimeframeBias, computeMultiTFAlignment, computeTrendBias } from '../agents/multiTimeframeAlignment.js';
import { checkKeyLevelProximity } from '../agents/keyLevels.js';

// Sessiefilter: actief 08:00–17:00 UTC (London open t/m NY-sessie).
// Uitgebreid van 13:00 naar 08:00 UTC (Fase 75): London-bewegingen (08:00–12:00 UTC)
// zijn cruciaal als context voor de agents — ook als het handelssignaal zelf pas
// in de NY-sessie (13:00–17:00 UTC) valt. Sessie-timing is boardroom-criterium
// (analist beoordeelt kill zones via ⑥), geen harde externe blokkade.
export function isActiveSession(now = new Date()) {
  const hour = now.getUTCHours();
  return hour >= 8 && hour < 17;
}

// Dagfilter: maandag heeft de laagste WR (40.9%) van alle weekdagen.
// Oorzaak: gap-risico van weekend, institutionelen orienteren zich nog,
// dunne orderflow in de eerste handelsuren van de week. Zie Fase 51.
export function isActiveDay(now = new Date()) {
  return now.getUTCDay() !== 1; // 1 = maandag
}

// Weekend gap-risico: vrijdag na 12:00 UTC. XAU/USD kan over het weekend gatten —
// een technisch correcte SL kan geraakt worden zonder structuurbreuk.
// Boardroom past hard positiegrootte-override toe op vrijdag na 12:00.
export function hasFridayGapRisk(now = new Date()) {
  return now.getUTCDay() === 5 && now.getUTCHours() >= 12;
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

  // 3. Trendfilter (W1 moet een heldere richting hebben — 'mixed' W1 blokkeert)
  const trendBias = computeTrendBias(d1Candles, w1Candles);
  if (!trendBias.aligned) {
    blockers.push('W1-trendrichting onduidelijk (W1 bias: mixed)');
  }

  // 4. Sleutelniveau-proximity (vroeg berekend: bepaalt of counter-trend triggers mogen doorgaan).
  // d1Candles meegeven zodat vorige dag high/low en H1 swing levels ook gedetecteerd worden.
  const nearLevel = checkKeyLevelProximity(h1Candles, w1Candles, d1Candles);

  // 5. Richtingsconsistentie (TF-alignment en trendfilter moeten dezelfde kant wijzen).
  // Uitzondering: als prijs zich nabij een bewezen sleutelniveau bevindt, staan we een
  // counter-trend trigger toe. Institutionele reversals vinden precies daar plaats —
  // premium short in bull market, discount long in bear market. De kwaliteitsfilters
  // (setupQualityScore, DA counter-confidence, filter 7) zorgen voor de verdere selectie.
  const isCounterTrend =
    tfAlignment.aligned && trendBias.aligned && tfAlignment.direction !== trendBias.direction;
  if (isCounterTrend && !nearLevel.near) {
    blockers.push(
      `TF-richting (${tfAlignment.direction}) conflicteert met trendrichting (${trendBias.direction})`,
    );
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
      isCounterTrend: isCounterTrend && nearLevel.near,
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
  const m15Note =
    details.m15Bias === direction
      ? `M15 bevestigt ook (${details.m15Bias}).`
      : `M15 is ${details.m15Bias === 'mixed' ? 'gemengd' : details.m15Bias} (pullback op entry-timeframe — normaal bij ICT-setups, weeg dit mee in je triggercriterium ⑤).`;
  const counterTrendWarning = details.isCounterTrend
    ? `\n\n⚠️ COUNTER-TREND TRIGGER: H1+M30 wijzen ${direction} maar de weektrend (W1) is ` +
      `${details.trendBias.direction}. Dit is een institutionele reversal-kans nabij een ` +
      `sleutelniveau. Vereisten: zit de prijs in een premium zone (voor short) of discount zone ` +
      `(voor long)? Bevestig minimaal 5/6 ICT-criteria. De kwaliteitsfilters zijn extra streng.`
    : '';
  return (
    `\n\nAlgoritmische trigger: drie harde voorwaarden zijn voldaan. ` +
    `H1 en M30 zijn beiden ${direction === 'bullish' ? 'bullish' : 'bearish'} aligned. ` +
    `${m15Note} ` +
    `D1- en W1-trendrichting: ${details.trendBias.direction}. ` +
    `${levelNote} ` +
    `Dit is een condition-based setup-signaal, niet een tijdgebonden analyse — ` +
    `weeg dit mee bij je zekerheidspercentage.` +
    counterTrendWarning
  );
}
