import { summarize } from './outcomeEvaluator.js';

// Stond de Devil's Advocate uiteindelijk "aan dezelfde kant" als het CEO-besluit
// (zeldzaam - de DA wordt expliciet gevraagd het besluit uit te dagen)?
export function classifyDevilsAdvocate(sample) {
  const { counterSignal } = sample.discussion.devilsAdvocate;
  return counterSignal === sample.decision.signal ? 'eens' : 'oneens';
}

// Komt de marktcontext (risk-on/risk-off) overeen met de richting van het besluit?
export function classifyMacroAlignment(sample) {
  const { sentiment } = sample.discussion.macro;
  const { signal } = sample.decision;
  if (sentiment === 'neutraal' || signal === 'neutral') return 'neutraal';
  const aligned =
    (sentiment === 'risk-on' && signal === 'bullish') || (sentiment === 'risk-off' && signal === 'bearish');
  return aligned ? 'aligned' : 'contrarian';
}

// Ging de zekerheid van de analist omhoog/omlaag/gelijk na het weerwoord op de discussie?
export function classifyRebuttalShift(sample) {
  const { analyst, analystRebuttal } = sample.discussion;
  const delta = analystRebuttal.confidence - analyst.confidence;
  if (delta < 0) return 'omlaag';
  if (delta > 0) return 'omhoog';
  return 'gelijk';
}

// Volgt het CEO-besluit de richting van de eerste analyse, of wijkt het af?
export function classifyCeoAgreement(sample) {
  return sample.decision.signal === sample.discussion.analyst.signal ? 'volgt-analist' : 'wijkt-af';
}

export function classifyConfidenceBucket(sample) {
  const { confidence } = sample.decision;
  if (confidence < 60) return '<60%';
  if (confidence <= 70) return '60-70%';
  return '>70%';
}

export function classifyRiskReward(sample) {
  const { entryPrice, decision } = sample;
  const reward = Math.abs(decision.takeProfit - entryPrice);
  const risk = Math.abs(entryPrice - decision.stopLoss);
  const rr = reward / risk;
  if (rr < 1.5) return '<1.5';
  if (rr <= 2.5) return '1.5-2.5';
  return '>2.5';
}

// Combo-signaal uit de Fase 9/10-backtest-analyses: zekerheid omhoog na het
// weerwoord, gecombineerd met risk/reward <1.5, hangt samen met een duidelijk
// hogere winRate dan de rest (record #10: 81.8% N=12 vs. 31.9% N=74).
export function isComboSignal(sample) {
  return classifyRebuttalShift(sample) === 'omhoog' && classifyRiskReward(sample) === '<1.5';
}

// Kwaliteitsfilter: drie onafhankelijk vastgestelde signalen die sterk
// samenhangen met SL-uitkomsten. Geeft { passed, blockers } terug.
// - passed: true = alle filters groen, signal mag gemeld worden als actie
// - blockers: lijst van redenen bij passed=false (leeg als passed=true)
// Neutrale besluiten altijd doorgelaten (geen positie, niets te filteren).
export function assessSignalQuality(sample) {
  if (!sample.discussion || sample.decision.signal === 'neutral') {
    return { passed: true, blockers: [] };
  }

  const blockers = [];

  if (sample.decision.confidence < 60) {
    blockers.push('CEO-zekerheid onder 60%');
  }
  if (classifyMacroAlignment(sample) === 'contrarian') {
    blockers.push('macro contraireert de richting');
  }
  if (classifyRebuttalShift(sample) === 'omlaag') {
    blockers.push('analist verloor vertrouwen na discussie');
  }
  if (sample.entryPrice != null && classifyRiskReward(sample) === '>2.5') {
    blockers.push('risico/winst-verhouding te ambitieus (>2.5)');
  }
  if ((sample.discussion.devilsAdvocate?.counterConfidence ?? 0) > 70) {
    blockers.push('pre-mortem: duidelijk faalscenario gevonden (>70%)');
  }

  // Setup-kwaliteitsscore: als de analist minder dan 3 van de 6 ICT/SMC-criteria
  // aanwezig vindt, is er geen handelbare setup — altijd blokkeren ongeacht de rest.
  const setupScore = sample.discussion.analyst?.setupQualityScore;
  if (setupScore !== undefined && setupScore !== null && setupScore < 3) {
    blockers.push(`setup-kwaliteit te laag (${setupScore}/6 criteria aanwezig)`);
  }

  // Counter-trend blocker: als D1 én W1 beide dezelfde richting wijzen én het signaal
  // is tegengesteld, is de kans op succes historisch laag — de hogere trend wint vrijwel altijd.
  const { dailyTrend, weeklyTrend } = sample;
  if (
    dailyTrend && weeklyTrend &&
    dailyTrend !== 'neutraal' && weeklyTrend !== 'neutraal' &&
    dailyTrend === weeklyTrend
  ) {
    const isContrarian =
      (sample.decision.signal === 'bullish' && dailyTrend === 'bearish') ||
      (sample.decision.signal === 'bearish' && dailyTrend === 'bullish');
    if (isContrarian) {
      blockers.push(`counter-trend: signaal ${sample.decision.signal} tegen D1+W1 ${dailyTrend} trend`);
    }
  }

  return { passed: blockers.length === 0, blockers };
}

// Groepeert samples per classificatie-label en berekent per groep de outcome-stats
// via summarize(). Samples zonder discussion-data (oude backtests, vóór Fase 9)
// worden overgeslagen - deze breakdowns hebben de teamdiscussie nodig.
// labelOrder is optioneel: geeft een vaste volgorde (incl. lege groepen) voor
// overzichtelijke rapportage.
export function breakdown(samples, classifyFn, labelOrder) {
  const withDiscussion = samples.filter((s) => s.discussion);
  const groups = new Map();
  for (const s of withDiscussion) {
    const label = classifyFn(s);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(s);
  }
  const labels = labelOrder || [...groups.keys()];
  return labels.map((label) => ({ label, ...summarize(groups.get(label) ?? []) }));
}
