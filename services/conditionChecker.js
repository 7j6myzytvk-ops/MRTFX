import { computeTimeframeBias, computeMultiTFAlignment, computeTrendBias } from '../agents/multiTimeframeAlignment.js';
import { checkKeyLevelProximity } from '../agents/keyLevels.js';

// Sessiefilter: actief 07:00–17:00 UTC (London pre-open t/m NY-sessie).
// Uitgebreid van 08:00 naar 07:00 (Fase 98): London open begint feitelijk om 07:00 UTC
// met instituties die posities klaarzetten voor de kill zone (07:00–10:00 UTC).
export function isActiveSession(now = new Date()) {
  const day = now.getUTCDay();
  if (day === 6) return false;
  if (day === 0 && now.getUTCHours() < 21) return false;
  const hour = now.getUTCHours();
  return hour >= 7 && hour < 17;
}

// Dagfilter: maandag heeft de laagste WR (40.9%) van alle weekdagen.
export function isActiveDay(now = new Date()) {
  return now.getUTCDay() !== 1;
}

// Weekend gap-risico: vrijdag na 12:00 UTC.
export function hasFridayGapRisk(now = new Date()) {
  return now.getUTCDay() === 5 && now.getUTCHours() >= 12;
}

// Controleert twee harde voorwaarden: sessie + H1/M30-alignment.
// Bepaalt ook trendMode: wanneer 4H + D1 + H1 + M30 allemaal dezelfde richting wijzen,
// activeert het systeem het trend-continuation analysepad (lichtere ICT-criteria).
// Geeft { triggered, direction, trendMode, blockers, details } terug.
export function checkConditions({
  h1Candles,
  m30Candles,
  m15Candles,
  d1Candles,
  w1Candles,
  h4Candles = null,
  now = new Date(),
} = {}) {
  const blockers = [];

  // 1. Sessiefilter
  if (!isActiveSession(now)) {
    blockers.push('buiten actieve sessie (08:00–17:00 UTC)');
  }

  // 2. Multi-timeframe alignment (H1 + M30 moeten het eens zijn).
  const h1Bias  = computeTimeframeBias(h1Candles);
  const m30Bias = computeTimeframeBias(m30Candles);
  const m15Bias = computeTimeframeBias(m15Candles);
  const tfAlignment = computeMultiTFAlignment(h1Bias, m30Bias, m15Bias);
  if (!tfAlignment.aligned) {
    blockers.push(`timeframes niet aligned (H1: ${h1Bias}, M30: ${m30Bias}, M15: ${m15Bias})`);
  }

  // 3. W1-trendrichting als context (geen blokkade).
  const trendBias = computeTrendBias(d1Candles, w1Candles);

  // 4. Sleutelniveau-proximity: context voor agents.
  const nearLevel = checkKeyLevelProximity(h1Candles, w1Candles, d1Candles);

  // 5. Trend-modus detectie: 4H + D1 aligned in dezelfde richting (Fase 98).
  // Eerder vereiste dit ook H1+M30 alignment — daardoor activeerde trend-modus NIET tijdens
  // pullbacks (H1+M30 tijdelijk tegen de trend) wat juist de optimale entry is.
  // Nu: H4+D1 aligned = trend actief, ook als H1+M30 een pullback laten zien.
  // Trigger (H1+M30 aligned) valt dan samen met een TEGENSTELDE H4+D1-trend →
  // boardroom analyseert de pullback als trend-continuation entry.
  const h4Bias = h4Candles && h4Candles.length >= 20 ? computeTimeframeBias(h4Candles) : null;
  const d1Bias = d1Candles && d1Candles.length >= 20 ? computeTimeframeBias(d1Candles) : null;
  const trendMode =
    h4Bias !== null && d1Bias !== null &&
    h4Bias !== 'neutraal' && d1Bias !== 'neutraal' &&
    h4Bias === d1Bias;

  // Counter-trend detectie (t.o.v. W1) — alleen voor context-noot, geen blokkade.
  const isCounterTrend =
    tfAlignment.aligned && trendBias.aligned && tfAlignment.direction !== trendBias.direction;

  const triggered  = blockers.length === 0;
  const direction  = tfAlignment.direction;

  return {
    triggered,
    direction,
    trendMode,
    blockers,
    details: {
      session: isActiveSession(now),
      h1Bias,
      m30Bias,
      m15Bias,
      h4Bias,
      d1Bias,
      tfAlignment,
      trendBias,
      nearLevel,
      isCounterTrend,
      trendMode,
    },
  };
}

// Formatteert de trigger-context als aanvullende noot voor de agents.
// In trend-modus: andere framing (geen reversal-logica, pullback-hervatting centraal).
export function formatConditionContext(conditions) {
  if (!conditions || !conditions.triggered) return '';
  const { direction, trendMode, details } = conditions;

  const dirLabel = direction === 'bullish' ? 'BULLISH' : 'BEARISH';
  const m15Note  = details.m15Bias === direction
    ? `M15 bevestigt ook (${details.m15Bias}).`
    : `M15 is ${details.m15Bias === 'mixed' ? 'gemengd' : details.m15Bias} (pullback op entry-timeframe).`;

  if (trendMode) {
    const levelNote = details.nearLevel?.near
      ? `Prijs bevindt zich nabij ${details.nearLevel.label} ($${details.nearLevel.level.toFixed(2)}) — extra confluence.`
      : `Prijs bevindt zich niet nabij een specifiek sleutelniveau.`;
    return (
      `\n\nAlgoritmische trigger (TREND-MODUS): 4H + D1 + H1 + M30 zijn alle ${dirLabel} aligned. ` +
      `Dit is een trend-continuatie setup — geen reversal-logica. ` +
      `${m15Note} ${levelNote} ` +
      `Primaire vraag voor de analyse: is er een pullback geweest binnen de trend ` +
      `en wil de prijs nu verder in de trend-richting?`
    );
  }

  // Reversal-modus (standaard)
  const levelNote = details.nearLevel?.near
    ? `Prijs bevindt zich nabij ${details.nearLevel.label} ($${details.nearLevel.level.toFixed(2)}, ${details.nearLevel.approachDirection}) — verhoogt setup-kwaliteit.`
    : `Prijs bevindt zich NIET nabij een gekend sleutelniveau — weeg dit mee in je setupQualityScore (verlaagt kwaliteit).`;
  const counterTrendWarning = details.isCounterTrend
    ? `\n\n⚠️ CONTEXT: H1+M30 wijzen ${direction} maar de weektrend (W1) is nog ` +
      `${details.trendBias.direction}. W1 is macro-achtergrond — geen blokkade. ` +
      `Als H4 en D1 al gedraaid zijn, is dit een legitieme setup. ` +
      `Controleer of de 4H CHoCH bevestigd is voordat je hoge zekerheid toekent.`
    : '';
  return (
    `\n\nAlgoritmische trigger (REVERSAL-MODUS): H1 en M30 zijn beiden ${dirLabel} aligned. ` +
    `${m15Note} ` +
    `D1- en W1-trendrichting: ${details.trendBias.direction}. ` +
    `${levelNote} ` +
    `Dit is een condition-based setup-signaal — weeg dit mee bij je zekerheidspercentage.` +
    counterTrendWarning
  );
}
