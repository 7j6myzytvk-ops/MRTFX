/**
 * Event-monitor: detecteert uitschietende prijsbewegingen (spikes) die wijzen
 * op een macro-event (PMI, NFP, Fed-speech, geopolitiek). Werkt onafhankelijk
 * van de condition-checker — de spike IS de trigger.
 *
 * Architectuurprincipe: geen handmatige kalender bijhouden. Een candle die
 * 2× ATR beweegt tijdens sessie-uren is bijna altijd event-gedreven.
 */

// Een M15-candle moet minstens 2× ATR bewegen om als spike te gelden.
// 2× ATR is conservatief genoeg om normale volatiliteit te negeren.
export const SPIKE_ATR_MULTIPLIER = 2.0;

// Spike-cooldown: 2 uur. Korter dan de condition-cooldown (4u) zodat een
// event-alert en een latere condition-setup onafhankelijk kunnen vuren.
export const SPIKE_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/**
 * Controleert of de laatste candle een spike is (range > multiplier × ATR14).
 * Geeft { spike: false } als er te weinig data is om te beoordelen.
 *
 * @param {Array}  candles    - M15-candles, meest recent als laatste
 * @param {number} atr14      - ATR(14) berekend over dezelfde candles
 * @param {number} multiplier - drempel als veelvoud van ATR (standaard: 2.0)
 */
export function detectPriceSpike(candles, atr14, multiplier = SPIKE_ATR_MULTIPLIER) {
  if (!candles || candles.length < 2 || !atr14 || atr14 <= 0) {
    return { spike: false };
  }

  const last = candles[candles.length - 1];
  const range = last.high - last.low;
  const threshold = atr14 * multiplier;

  if (range < threshold) return { spike: false };

  return {
    spike: true,
    candleTime: last.time,
    range: Math.round(range * 100) / 100,
    atr14: Math.round(atr14 * 100) / 100,
    threshold: Math.round(threshold * 100) / 100,
    spikeMultiple: Math.round((range / atr14) * 10) / 10,
    direction: last.close >= last.open ? 'bullish' : 'bearish',
  };
}

/**
 * Bouwt de context-noot voor de boardroom wanneer die event-gedreven wordt
 * samengesteld. De macro- en geopolitiek-analist krijgen een expliciete opdracht
 * om de aanleiding te identificeren en de impact te wegen.
 */
export function formatSpikeContext(spikeInfo, newsItems = []) {
  const newsNote =
    newsItems.length > 0
      ? `\n\nActueel nieuws op het moment van de uitschietende beweging:\n${newsItems
          .slice(0, 6)
          .map((n) => `- [${n.publishedAt?.slice(0, 16) ?? '?'}] ${n.title}`)
          .join('\n')}`
      : '\n\nGeen recent nieuws gevonden via geautomatiseerde bronnen — onderzoek zelf de aanleiding.';

  return (
    `\n\nEVENT-ALERT — UITSCHIETENDE PRIJSBEWEGING GEDETECTEERD\n` +
    `Candle-tijd: ${spikeInfo.candleTime} | Range: $${spikeInfo.range} (${spikeInfo.spikeMultiple}× ATR) | Richting: ${spikeInfo.direction}\n\n` +
    `DIT IS GEEN CONDITION-BASED SETUP — de boardroom is bijeengeroepen omdat de markt\n` +
    `abnormaal beweegt, wat wijst op een macro-event, nieuwsitem of institutionele orderflow.\n\n` +
    `MACRO-ANALIST + GEOPOLITIEK-ANALIST: uw primaire taak is het identificeren van de\n` +
    `aanleiding van deze beweging en het wegen van de impact op XAU/USD op korte termijn.\n` +
    `Koppel uw bevindingen expliciet terug in uw analyse — de CEO en de overige agents\n` +
    `bouwen hierop voort bij hun besluitvorming.` +
    newsNote
  );
}
