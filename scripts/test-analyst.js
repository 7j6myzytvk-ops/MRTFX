import { analyzeCandles } from '../agents/analyst.js';
import { mockCandles } from '../agents/fixtures/mockCandles.js';

const result = await analyzeCandles(mockCandles);
console.log('Analyse:', result);
