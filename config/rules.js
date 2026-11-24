/**
 * Bevroren filterdrempels en systeemconstanten — CLAUDE.md parameter-freeze (31 jul 2026).
 *
 * Wijzig niets zonder ≥100 doorgelaten live-signalen met uitkomst én een duidelijk
 * statistisch patroon. Zie CLAUDE.md voor de volledige freeze-omschrijving.
 *
 * Code-afgedwongen constanten (actief in logica):
 *   FLAT_RANGE_THRESHOLD, HORIZON_CANDLES, MIN_SETUP_SCORE, PRICE_SANITY_RATIO
 *
 * Prompt-afgedwongen drempels (in CEO/agent-prompts, niet extern gecontroleerd):
 *   CEO_MIN_CONFIDENCE — staat in ceo.js prompttekst
 *   ATR_MIN, DA_MAX_CONVICTION, REBUTTAL_MIN_DELTA, MIN_RISK_REWARD — CLAUDE.md referentie
 */

// --- Outcome-evaluatie ---
// Candles met een H-L range kleiner dan dit worden als weekend-placeholder gefilterd.
export const FLAT_RANGE_THRESHOLD = 1.0;

// Aantal H1-candles (~2 dagen) waarbinnen een SL/TP-hit gezocht wordt.
export const HORIZON_CANDLES = 48;

// Als midpoint van SL/TP meer dan dit percentage afwijkt van de huidige prijs,
// is het signaal onbruikbaar (prijsschaal-mismatch uit een andere era).
export const PRICE_SANITY_RATIO = 0.3;

// --- Kwaliteitsfilter (agentAnalysis.assessSignalQuality) ---
// Setup-score minimum voor een handelbaar signaal (reversal: /6, trend: /4).
export const MIN_SETUP_SCORE = 3;

// --- CLAUDE.md bevroren drempels (prompt-afgedwongen, niet verwijderd) ---
// CEO-zekerheidsminimum voor een directioneel signaal (staat in ceo.js prompt).
export const CEO_MIN_CONFIDENCE = 55;

// Minimale ATR op H1 ($) voor een geldig signaal.
export const ATR_MIN = 8;

// Devil's Advocate-overtuigingskracht boven dit percentage blokkeert het signaal.
export const DA_MAX_CONVICTION = 82;

// Rebuttal-delta (analist na weerwoord t.o.v. voor): onder dit % is de analist
// significant teruggedraaid — signaal blokkeren.
export const REBUTTAL_MIN_DELTA = -35;

// Minimum R:R voor een directioneel signaal.
export const MIN_RISK_REWARD = 1.0;
