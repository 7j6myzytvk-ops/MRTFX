export function formatCandles(candles) {
  return candles
    .map((c) => `${c.time} O:${c.open} H:${c.high} L:${c.low} C:${c.close}`)
    .join('\n');
}
