import { sma } from './indicators.js';
import { computeTimeframeBias } from './multiTimeframeAlignment.js';

export function computeWeeklyContext(candles) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map((c) => c.close);
  const currentClose = closes[closes.length - 1];
  const sma20 = closes.length >= 20 ? sma(closes, 20) : null;

  const fiveWeekAgoClose = closes[closes.length - 6] ?? closes[0];
  const fiveWeekChangePct = ((currentClose - fiveWeekAgoClose) / fiveWeekAgoClose) * 100;

  const bias = computeTimeframeBias(candles);

  return {
    currentClose,
    sma20,
    priceVsSma: sma20 != null ? (currentClose > sma20 ? 'boven' : 'onder') : null,
    fiveWeekChangePct,
    trend: bias === 'mixed' ? 'neutraal' : bias,
  };
}

export function formatWeeklyContextNote(ctx) {
  if (!ctx) return '';

  const { currentClose, sma20, priceVsSma, fiveWeekChangePct, trend } = ctx;

  const sign = fiveWeekChangePct >= 0 ? '+' : '';
  const momentum =
    fiveWeekChangePct > 1.5 ? 'STIJGEND' : fiveWeekChangePct < -1.5 ? 'DALEND' : 'ZIJWAARTS';

  const smaNote =
    sma20 != null && priceVsSma
      ? `, 20-weeks gem.: ${sma20.toFixed(2)} — prijs ${priceVsSma === 'boven' ? 'BOVEN' : 'ONDER'} het weekgem.`
      : '';

  return (
    `\n\nWeektrendcontext (XAU/USD W1 — hogere tijdseenheid geeft de macro-weektrend als ` +
    `achtergrond voor H1-setups): weekkoers ${currentClose.toFixed(2)}${smaNote}. ` +
    `5-weeks verandering: ${sign}${fiveWeekChangePct.toFixed(1)}% (${momentum}). ` +
    `Weektrend: ${trend.toUpperCase()}. ` +
    `BELANGRIJK: signalen TEGEN de weektrend vereisen aanzienlijk hogere bevestiging — ` +
    `de weektrend wint op langere termijn bijna altijd.`
  );
}
