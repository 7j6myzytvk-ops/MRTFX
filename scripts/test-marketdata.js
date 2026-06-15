import { getXauUsdPrice, getXauUsdCandles } from '../services/marketData.js';

const price = await getXauUsdPrice();
console.log('Prijs:', price);

const candles = await getXauUsdCandles({ granularity: 'H1', count: 5 });
console.log('Candles:', candles);
