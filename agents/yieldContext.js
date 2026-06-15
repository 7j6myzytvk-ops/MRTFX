import { sma } from './indicators.js';

// De Amerikaanse 2-jaars staatsobligatierente (US2Y) is een proxy voor de reële
// rente/het renteklimaat. Goud levert zelf geen rente op, dus een stijgende
// rente verhoogt de opportunity cost van het aanhouden van goud (doorgaans
// bearish voor XAU/USD) en een dalende rente verlaagt die opportunity cost
// (doorgaans bullish voor XAU/USD).
export function computeYieldContext(candles) {
  const closes = candles.map((c) => c.close);
  return {
    lastClose: closes[closes.length - 1],
    firstClose: closes[0],
    sma20: sma(closes, 20),
  };
}

export function formatYieldContextNote(context) {
  const { lastClose, firstClose, sma20 } = context;
  const changeBps = (lastClose - firstClose) * 100; // 1 procentpunt = 100 basispunten

  const direction = changeBps >= 0 ? 'gestegen' : 'gedaald';
  const costDirection = changeBps >= 0 ? 'verhoogt' : 'verlaagt';
  const goldBias = changeBps >= 0 ? 'druk op' : 'steun voor';
  const vsSma = lastClose > sma20 ? 'boven' : 'onder';

  return (
    `\n\nRente-context (Amerikaanse 2-jaars staatsobligatierente, indicator voor het renteklimaat ` +
    `en daarmee de opportunity cost van het aanhouden van goud - goud levert zelf geen rente op): ` +
    `de 2-jaars rente staat op ${lastClose.toFixed(2)}% en is ${Math.abs(changeBps).toFixed(0)} ` +
    `basispunten ${direction} over de getoonde periode (ligt daarmee ${vsSma} het 20-daags ` +
    `gemiddelde van ${sma20.toFixed(2)}%). Een ${direction} rente ${costDirection} de opportunity ` +
    `cost van goud, wat doorgaans extra ${goldBias} XAU/USD geeft - weeg dit mee als één van de ` +
    `factoren, niet als enige indicator.`
  );
}
