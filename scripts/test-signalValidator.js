import { validateSignalStructure, formatHealthReport, summarizeSignalHealth } from '../services/signalValidator.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? 'OK  ' : 'FAIL', label);
  if (!ok) {
    console.log('  verwacht:', JSON.stringify(expected));
    console.log('  ontvangen:', JSON.stringify(actual));
    fail++;
  } else {
    pass++;
  }
}

// Basisresultaat dat alle checks doorstaat
const valid = {
  instrument: 'XAU_USD',
  granularity: 'H1',
  entryPrice: 3100,
  decision: { signal: 'bullish', confidence: 68, stopLoss: 3060, takeProfit: 3180, positionSize: 'normaal', reasoning: 'test' },
  discussion: {
    analyst: { signal: 'bullish', confidence: 65, setupQualityScore: 4, reasoning: 'test' },
    riskManager: { stopLoss: 3060, takeProfit: 3180, positionSize: 'normaal', reasoning: 'test' },
    devilsAdvocate: { counterSignal: 'bearish', counterConfidence: 35, argument: 'test' },
    macro: { sentiment: 'risk-on', confidence: 60, reasoning: 'test' },
    analystRebuttal: { signal: 'bullish', confidence: 67, reasoning: 'test' },
  },
  qualityResult: { passed: true, blockers: [] },
};

// --- Geldig signaal ---
const r = validateSignalStructure(valid);
check('geldig signaal -> valid=true', r.valid, true);
check('geldig signaal -> geen errors', r.errors.length, 0);
check('geldig signaal -> geen warnings', r.warnings.length, 0);

// --- Ongeldig signal-waarde ---
const badSignal = { ...valid, decision: { ...valid.decision, signal: 'sideways' } };
check('ongeldig signal -> valid=false', validateSignalStructure(badSignal).valid, false);
check('ongeldig signal -> juiste error', validateSignalStructure(badSignal).errors.some(e => e.includes('decision.signal ongeldig')), true);

// --- Confidence buiten bereik ---
const badConf = { ...valid, decision: { ...valid.decision, confidence: 150 } };
check('confidence 150 -> valid=false', validateSignalStructure(badConf).valid, false);

// --- Ongeldige positionSize ---
const badSize = { ...valid, decision: { ...valid.decision, positionSize: 'mega' } };
check('positionSize mega -> valid=false', validateSignalStructure(badSize).valid, false);

// --- setupQualityScore ontbreekt -> warning, niet error ---
const noScore = {
  ...valid,
  discussion: { ...valid.discussion, analyst: { signal: 'bullish', confidence: 65 } },
};
const noScoreR = validateSignalStructure(noScore);
check('ontbrekende score -> valid=true (warning)', noScoreR.valid, true);
check('ontbrekende score -> heeft warning', noScoreR.warnings.length > 0, true);

// --- setupQualityScore buiten bereik ---
const badScore = {
  ...valid,
  discussion: { ...valid.discussion, analyst: { ...valid.discussion.analyst, setupQualityScore: 9 } },
};
check('score 9 -> valid=false', validateSignalStructure(badScore).valid, false);

// --- Inconsistentie: score<3 maar passed=true ---
const inconsistentScore = {
  ...valid,
  discussion: { ...valid.discussion, analyst: { ...valid.discussion.analyst, setupQualityScore: 2 } },
  qualityResult: { passed: true, blockers: [] },
};
const ir = validateSignalStructure(inconsistentScore);
check('score 2 + passed=true -> INCONSISTENTIE error', ir.errors.some(e => e.includes('INCONSISTENTIE')), true);
check('score 2 + passed=true -> valid=false', ir.valid, false);

// --- Score<3 maar passed=false (correct) ---
const correctlyBlocked = {
  ...valid,
  discussion: { ...valid.discussion, analyst: { ...valid.discussion.analyst, setupQualityScore: 2 } },
  qualityResult: { passed: false, blockers: ['setup-kwaliteit te laag (2/6 criteria aanwezig)'] },
};
check('score 2 + passed=false -> valid=true', validateSignalStructure(correctlyBlocked).valid, true);

// --- Inconsistentie: confidence<60 maar passed=true ---
const lowConfPassed = {
  ...valid,
  decision: { ...valid.decision, confidence: 55 },
  qualityResult: { passed: true, blockers: [] },
};
check('conf 55 + passed=true -> INCONSISTENTIE', validateSignalStructure(lowConfPassed).errors.some(e => e.includes('INCONSISTENTIE')), true);

// --- SL/TP richting: bullish maar SL >= entryPrice ---
const badSlBullish = {
  ...valid,
  decision: { ...valid.decision, signal: 'bullish', stopLoss: 3150 }, // SL boven entry
};
check('bullish + SL >= entry -> INCONSISTENTIE', validateSignalStructure(badSlBullish).errors.some(e => e.includes('INCONSISTENTIE: bullish')), true);

// --- SL/TP richting: bearish maar SL <= entryPrice ---
const badSlBearish = {
  ...valid,
  entryPrice: 3100,
  decision: { ...valid.decision, signal: 'bearish', stopLoss: 3050, takeProfit: 2980 }, // SL ONDER entry voor bearish
};
check('bearish + SL <= entry -> INCONSISTENTIE', validateSignalStructure(badSlBearish).errors.some(e => e.includes('INCONSISTENTIE: bearish')), true);

// --- Neutraal signaal: SL/TP-checks slaan over ---
const neutralSignal = {
  ...valid,
  decision: { ...valid.decision, signal: 'neutral', confidence: 45, stopLoss: 3150 },
  qualityResult: { passed: true, blockers: [] },
};
check('neutral signaal -> geen SL-consistentie check', validateSignalStructure(neutralSignal).errors.filter(e => e.includes('SL')).length, 0);

// --- Macro sentiment ongeldig ---
const badMacro = {
  ...valid,
  discussion: { ...valid.discussion, macro: { sentiment: 'bullish', confidence: 60 } },
};
check('macro.sentiment ongeldig -> error', validateSignalStructure(badMacro).errors.some(e => e.includes('macro.sentiment')), true);

// --- formatHealthReport: alles goed ---
check('formatHealthReport geldig -> ✅', formatHealthReport({ valid: true, errors: [], warnings: [] }).startsWith('✅'), true);
check('formatHealthReport met warning -> ⚠️', formatHealthReport({ valid: true, errors: [], warnings: ['iets'] }).startsWith('⚠️'), true);
check('formatHealthReport fout -> 🚨', formatHealthReport({ valid: false, errors: ['X'], warnings: [] }).startsWith('🚨'), true);

// --- summarizeSignalHealth ---
const sum = summarizeSignalHealth([valid, valid]);
check('summarize: n=2', sum.n, 2);
check('summarize: valid=2', sum.valid, 2);
check('summarize: scoreDist[4]=2', sum.scoreDist[4], 2);

const withIssue = { ...valid, decision: { ...valid.decision, signal: 'sideways' } };
const sum2 = summarizeSignalHealth([valid, withIssue]);
check('summarize: invalid=1', sum2.invalid, 1);

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
