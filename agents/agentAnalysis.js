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

// Parseert entry-zone string ("$4066-$4074") naar het midpoint.
// Valt terug op entryPrice (slotkoers) als de zone ontbreekt of niet parseerbaar is.
function parseEntryMidpoint(decision, entryPrice) {
  if (!decision?.entryZone) return entryPrice;
  const clean = decision.entryZone.replace(/\$/g, '').replace(/\s/g, '');
  const match = clean.match(/([\d.]+)[–\-]([\d.]+)/);
  if (!match) return entryPrice;
  const mid = (parseFloat(match[1]) + parseFloat(match[2])) / 2;
  return isNaN(mid) ? entryPrice : mid;
}

export function classifyRiskReward(sample) {
  const { entryPrice, decision } = sample;
  const entry = parseEntryMidpoint(decision, entryPrice);
  const reward = Math.abs(decision.takeProfit - entry);
  const risk = Math.abs(entry - decision.stopLoss);
  if (risk === 0) return '<1.0';
  const rr = reward / risk;
  if (rr < 1.0) return '<1.0';
  if (rr <= 3.0) return '1.0-3.0';
  if (rr <= 5.0) return '3.0-5.0';
  return '>5.0';
}

// Premium-signaal: analist won vertrouwen na de teamdiscussie (rebuttal shift omhoog)
// EN de setup had hoge kwaliteit (setupQualityScore ≥ 4/6). Backtest toont dat
// deze combinatie samenhangt met de hoogste WR. Score < 5 of shift niet omhoog = geen combo.
export function isComboSignal(sample) {
  return (
    sample.decision?.signal !== 'neutral' &&
    classifyRebuttalShift(sample) === 'omhoog' &&
    (sample.discussion?.analyst?.setupQualityScore ?? 0) >= 4
  );
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

  // Fase 105: kwaliteitsfilter teruggebracht naar absolute minimum.
  // Zeven weken geen TP op doorgekomen signalen (jun 17 → aug 5 2026).
  // Gefilterde signalen: 54.5% WR. Doorgekomen signalen: 0% WR.
  // Alle filters van Fase 69–104 verwijderd — de filter werkte structureel omgekeerd.
  // Enige harde blokkades die overblijven:
  // 1. Setup score < 3: geen handelbare ICT-setup aanwezig
  // 2. AMD-fase onduidelijk: geen marktstructuur om op te handelen

  const setupScore = sample.discussion.analyst?.setupQualityScore;
  if (setupScore !== undefined && setupScore !== null && setupScore < 3) {
    blockers.push(`setup-kwaliteit te laag (${setupScore}/6 — geen handelbare setup)`);
  }

  const amdPhase = sample.discussion?.analyst?.amdPhase;
  if (amdPhase === 'onduidelijk') {
    blockers.push('AMD-fase onduidelijk — geen handelbare marktstructuur');
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
