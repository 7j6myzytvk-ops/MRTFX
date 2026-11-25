import { summarize } from './outcomeEvaluator.js';
import {
  MIN_SETUP_SCORE,
  ATR_MIN,
  CEO_MIN_CONFIDENCE,
  DA_MAX_CONVICTION,
  REBUTTAL_MIN_DELTA,
  MIN_RISK_REWARD,
} from '../config/rules.js';

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
  // undefined/null = model vulde het veld niet → behandel als score 0 (geen setup)
  const effectiveScore = (setupScore !== undefined && setupScore !== null) ? setupScore : 0;
  if (effectiveScore < MIN_SETUP_SCORE) {
    blockers.push(`setup-kwaliteit te laag (${setupScore ?? 'ontbreekt'}/6 — geen handelbare setup)`);
  }

  const amdPhase = sample.discussion?.analyst?.amdPhase;
  if (amdPhase === 'onduidelijk') {
    blockers.push('AMD-fase onduidelijk — geen handelbare marktstructuur');
  }

  // CEO-zekerheid: harde code-grens (config/rules.js CEO_MIN_CONFIDENCE).
  // De CEO-prompt instrueert hetzelfde, maar modellen wijken soms af — dit vangt die gevallen op.
  if (sample.decision.confidence < CEO_MIN_CONFIDENCE) {
    blockers.push(`CEO-zekerheid te laag (${sample.decision.confidence}% < ${CEO_MIN_CONFIDENCE}%)`);
  }

  // ATR-minimum: lage volatiliteit = kleine SL/TP absolute waarden = slechte uitvoerbaarheid.
  if (sample.atr14 != null && sample.atr14 < ATR_MIN) {
    blockers.push(`ATR te laag ($${sample.atr14.toFixed(1)} < $${ATR_MIN} — te weinig range voor betrouwbare SL/TP)`);
  }

  // Devil's Advocate-overtuiging: bij >82% heeft de DA een concreet, zwaar faalscenario gevonden.
  const daConviction = sample.discussion?.devilsAdvocate?.counterConfidence;
  if (daConviction != null && daConviction > DA_MAX_CONVICTION) {
    blockers.push(`DA-overtuigingskracht te hoog (${daConviction}% > ${DA_MAX_CONVICTION}% — concreet faalscenario aanwezig)`);
  }

  // Rebuttal-delta: analist verloor te veel vertrouwen na de teamdiscussie.
  const { analyst, analystRebuttal } = sample.discussion ?? {};
  if (analyst && analystRebuttal) {
    const delta = analystRebuttal.confidence - analyst.confidence;
    if (delta < REBUTTAL_MIN_DELTA) {
      blockers.push(`Analist verloor te veel overtuiging na weerwoord (delta ${delta}% < ${REBUTTAL_MIN_DELTA}%)`);
    }
  }

  // SL/TP richting-check: harde blokkade als SL of TP aan de verkeerde kant van de entry staat.
  // Dezelfde logica als signalValidator.js — vangt modellen op die SL en TP verwisselen.
  // Moet vóór de R:R-check staan: Math.abs maskeert richting-fouten anders.
  const { stopLoss, takeProfit } = sample.decision;
  const entry = sample.entryPrice;
  const signal_dir = sample.decision.signal;
  if (entry != null && stopLoss != null && signal_dir === 'bullish' && stopLoss >= entry) {
    blockers.push(`SL aan verkeerde kant ($${stopLoss} ≥ entry $${entry.toFixed(1)} — SL moet onder entry bij BULLISH)`);
  }
  if (entry != null && stopLoss != null && signal_dir === 'bearish' && stopLoss <= entry) {
    blockers.push(`SL aan verkeerde kant ($${stopLoss} ≤ entry $${entry.toFixed(1)} — SL moet boven entry bij BEARISH)`);
  }
  if (entry != null && takeProfit != null && signal_dir === 'bullish' && takeProfit <= entry) {
    blockers.push(`TP aan verkeerde kant ($${takeProfit} ≤ entry $${entry.toFixed(1)} — TP moet boven entry bij BULLISH)`);
  }
  if (entry != null && takeProfit != null && signal_dir === 'bearish' && takeProfit >= entry) {
    blockers.push(`TP aan verkeerde kant ($${takeProfit} ≥ entry $${entry.toFixed(1)} — TP moet onder entry bij BEARISH)`);
  }

  // R:R-ondergrens: te laag R:R maakt winstgevend handelen structureel onmogelijk.
  if (entry != null && stopLoss != null && takeProfit != null) {
    const risk   = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    if (risk > 0 && reward / risk < MIN_RISK_REWARD) {
      blockers.push(`R:R te laag (${(reward / risk).toFixed(2)} < ${MIN_RISK_REWARD})`);
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
