import { sma } from './indicators.js';

// EUR/USD is met ~58% het grootste onderdeel van de dollarindex (DXY) en beweegt
// daar (door de samenstelling van de index) in dezelfde richting mee als goud:
// EUR/USD omhoog -> dollar verzwakt -> doorgaans steun voor XAU/USD, en omgekeerd.
export function computeDollarContext(candles) {
  const closes = candles.map((c) => c.close);
  return {
    lastClose: closes[closes.length - 1],
    firstClose: closes[0],
    sma20: sma(closes, 20),
  };
}

export function formatDollarContextNote(context) {
  const { lastClose, firstClose, sma20 } = context;
  const changePct = ((lastClose - firstClose) / firstClose) * 100;

  const direction = changePct >= 0 ? 'gestegen' : 'gedaald';
  const dollarTrend = changePct >= 0 ? 'verzwakt' : 'versterkt';
  const goldBias = changePct >= 0 ? 'steun voor' : 'druk op';
  const vsSma = lastClose > sma20 ? 'boven' : 'onder';

  return (
    `\n\nDollarcontext (EUR/USD als proxy voor dollarsterkte - grootste component van de ` +
    `dollarindex, beweegt doorgaans gelijk op met goud): EUR/USD staat op ` +
    `${lastClose.toFixed(4)} en is ${Math.abs(changePct).toFixed(2)}% ${direction} over de ` +
    `getoonde periode (ligt daarmee ${vsSma} het 20-periode gemiddelde van ${sma20.toFixed(4)}). ` +
    `Dit duidt op een dollar die per saldo ${dollarTrend} is, wat doorgaans extra ${goldBias} ` +
    `XAU/USD geeft - weeg dit mee als één van de factoren, niet als enige indicator.`
  );
}
