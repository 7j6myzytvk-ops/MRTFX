import axios from 'axios';
import { config } from '../config/index.js';

const BASE_URLS = {
  practice: 'https://api-fxpractice.oanda.com',
  live: 'https://api-fxtrade.oanda.com',
};

function client() {
  return axios.create({
    baseURL: BASE_URLS[config.oanda.env],
    headers: {
      Authorization: `Bearer ${config.oanda.apiKey}`,
    },
  });
}

export async function getXauUsdPrice() {
  const { data } = await client().get(
    `/v3/accounts/${config.oanda.accountId}/pricing`,
    { params: { instruments: 'XAU_USD' } }
  );

  const price = data.prices?.[0];
  return {
    bid: price?.bids?.[0]?.price,
    ask: price?.asks?.[0]?.price,
    time: price?.time,
  };
}

export async function getXauUsdCandles({ granularity = 'H1', count = 50 } = {}) {
  const { data } = await client().get('/v3/instruments/XAU_USD/candles', {
    params: { granularity, count, price: 'M' },
  });

  return data.candles.map((c) => ({
    time: c.time,
    open: Number(c.mid.o),
    high: Number(c.mid.h),
    low: Number(c.mid.l),
    close: Number(c.mid.c),
    volume: c.volume,
  }));
}
