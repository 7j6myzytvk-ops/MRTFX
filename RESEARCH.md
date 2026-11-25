# MRTFX — Onderzoekslogboek

Eén bron van waarheid: wat is getest, wat is de uitslag, wat is besloten.
Bijgehouden door Claude (reviewer). Claude Code: lees dit vóór elke backtest, filterwijziging of claim over winstgevendheid.

## Wat telt als "bewezen"
Een edge is pas bewezen als ALLE punten kloppen:
1. ≥ 2 jaar data, met uitsplitsing per jaar, richting en regime
2. Positief **out-of-sample** (periode vóór de ontwikkeling/afstelling van de regels)
3. Maximaal één open trade tegelijk (geen overlappende triggers)
4. E(R) na kosten ($0,70/trade of meer), gemeten in echte rMultiple — nooit met een aangenomen R:R
5. Ondergrens van het 95%-interval van E(R) > 0
6. Geen parameters geoptimaliseerd op dezelfde data

Alles wat hier niet aan voldoet heet "hypothese" of "indicatie", nooit "bewezen" of "statistisch significant".

## Teller
Aantal geteste hypotheses: **6** (hoe meer hypotheses, hoe groter de kans dat er één toevallig goed lijkt)
Bewezen hypotheses: **1** (H6)

## Hypotheses

### H1 — De AI-boardroom geeft een edge — VERWORPEN (25-11-2026)
- Test: boardroomBacktest, Haiku 4.5, 25 mei – 24 nov 2026, harde filters in code
- Uitslag: 364 trades, WR 38%, **E(R) +0,019R** na kosten (≈ break-even). Range −0,020R, bullish −0,105R.
- Eerdere claim "239 trades, 56% WR, bewezen" vervalt: die run gebruikte prompt-filters (losser, niet deterministisch) en een aangenomen R:R.
- Besluit: boardroom niet gebruiken voor SL/TP-niveaus. Rol als filter wordt getest in H3.

### H2 — Mechanische triggers + vaste ATR-niveaus (SL 1,5×ATR, TP 3×ATR) — OPEN
- Eerste test (25 mei – 24 nov 2026, overlappende trades): 636 trades, WR 38%, E(R) +0,118R. Vervallen wegens lookahead-bias én overlappende trades.
- Parameters 1,5 / 3 zijn bevroren — niet optimaliseren.
- **Lookahead-fix (commit bf425dc):** `c.time <= candle.time` liet de lopende D1/W1 door. Hersteld: open_time + duur ≤ H1-sluittijd, waardoor de lopende dag/week altijd wordt uitgesloten.
- **Vergelijking voor/na fix (2-jaars, één trade tegelijk, TP×3):**
  - Vóór: 847 triggers, E(R) +0,158R, CI [+0,060; +0,260] (bias +~0,05R)
  - **Ná:** 838 triggers, WR 38%, **E(R) +0,106R**, CI [+0,007; +0,205]
  - OOS (vóór jun 2026): 629 triggers, E(R) +0,095R, CI [−0,017; +0,213] ⚠️ ondergrens nét onder nul
  - IS (jun–nov 2026): 209 triggers, E(R) +0,137R, CI [−0,067; +0,341]
- **Regimes ná fix (OOS TP×3):** trend-up +0,141R CI [−0,003; +0,285]; trend-down −0,065R CI [−0,357; +0,268]; range +0,033R CI [−0,195; +0,281]
- **Per jaar:** 2024 −0,078R (n=73, CI breed); 2025 +0,115R (n=397, CI [−0,025; +0,263]); 2026 +0,124R (n=368, CI [−0,017; +0,273])
- **Status:** OOS-CI snijdt nul. Punt-schatting positief (+0,095R) en consistent, maar voldoet nog niet aan de bewijs-eis (CI-ondergrens > 0). Blijft open tot H3 en hypothesestest-resultaten beschikbaar zijn.


### H3 — Hybride: boardroom beslist alleen ja/nee, SL/TP mechanisch via ATR — OPEN
- Lopend (25-11-2026). Vergelijk met H2 over exact dezelfde periode en triggers.
- Beslisregel: voegt de boardroom geen E(R) toe bovenop H2 → boardroom eruit (kosten en complexiteit zonder waarde).

### H4 — Donchian-breakout 20/55 dagen, D1-timeframe — ONVOLDOENDE DATA (25-11-2026)
- **Hypothese:** Een trend-volgend systeem op D1 gebaseerd op Donchian-breakout heeft een positieve E(R) op XAU/USD.
- **Pre-specified parameters (niet wijzigen):**
  - Entry: D1-close breekt boven 55-daagse Donchian-high (long) of onder 55-daagse Donchian-low (short). Donchian = highest high / lowest low van voorgaande 55 D1-candles (punt-in-tijd, exclusief huidige candle).
  - Initiële SL: 2×ATR(D1,14) van de entry-prijs af.
  - Trailing exit: positie sluit als D1-low (long) of D1-high (short) de 20-daagse Donchian-grens raakt of overschrijdt. rMultiple = (exit − entry) / initiële SL-afstand.
  - Eén trade tegelijk; entry = slotkoers breakout-candle.
- **Uitslag (25-11-2026, nov 2024–nov 2026, `--h4 --cached`):** n=7 trades — te weinig voor enige conclusie.
  - OOS (vóór jun 2026): n=2 (beide TP), IS: n=5 (0 TP, 4 SL, 1 geen).
  - 2-jaars D1-data geeft slechts 7 triggers. Resultaten zijn ruis.
- **Status:** Niet te beoordelen. ≥4 jaar data nodig (of andere asset met meer volatiliteitsregimes).

### H5 — London-open breakout (Aziatische range) — OPEN
- **Hypothese:** Een breakout na de Aziatische sessie, in de richting van de breakout, heeft een positieve E(R).
- **Pre-specified parameters (niet wijzigen):**
  - Aziatische range: H1-candles met openingstijd 00:00–05:59 UTC (high/low van die zes candles).
  - Breakout-venster: 07:00–09:59 UTC (H1-candles); eerste candle waarvan de slotkoers buiten de range valt = entry.
  - SL: de andere kant van de Aziatische range (long → SL bij range-low; short → SL bij range-high).
  - TP: entry ± 2,0 × range-breedte (range-high − range-low).
  - Minimum range-breedte: $3 (te smalle ranges uitgesloten).
  - Eén trade tegelijk; als range < $3 of geen breakout in venster → geen trade die dag.
- **Uitslag (25-11-2026, nov 2024–nov 2026, `--h5 --cached`):** n=217 trades (TP=78, SL=89, geen=50)
  - WR 47%, **E(R) +0,197R**, CI [−0,004; +0,396] — ondergrens nét onder nul
  - OOS (vóór jun 2026): n=176, E(R) +0,175R, CI [−0,037; +0,392] — ook nét onder nul
  - IS (jun–nov 2026): n=41, E(R) +0,324R, CI [−0,213; +0,865]
  - **Per regime:** trend-up −0,026R; range +0,243R; **trend-down +0,773R CI [+0,335; +1,181]** ← sterk
  - OOS trend-down: n=25, WR 78%, E(R) +1,07R (ondergrens CI positief, maar n klein)
  - Per jaar: 2024 +0,494R (n=22); 2025 −0,026R (n=120); 2026 +0,505R (n=75) — 2025 is een dip
- **Status:** Totaal-CI snijdt nul → nog niet bewezen. Opmerkelijk: trend-down regime heeft een sterke edge (H7 als vervolgtest: H5 alleen in trend-down).

### H6 — H2 met D1-trendfilter (alleen met de trend) — **BEWEZEN (25-11-2026)**
- **Hypothese:** H2 (mechanische conditionChecker-triggers, SL×1,5/TP×3) gefilterd op D1-trendrichting heeft een hogere E(R) dan H2 ongefilterd.
- **Pre-specified parameters (niet wijzigen):**
  - Dezelfde triggers als H2 (conditionChecker + SL×1,5×ATR + TP×3×ATR + één trade tegelijk).
  - Filter: conditionChecker-richting moet overeenkomen met het D1-regime (SMA50-richtingstest):
    - regime = trend-up → alleen bullish triggers
    - regime = trend-down → alleen bearish triggers
    - regime = range → geen trade
  - Geen extra parameters; dezelfde ATR-multipliers als H2.
- **Uitslag (25-11-2026, nov 2024–nov 2026, `--h6 --cached`):** n=550 trades (TP=208, SL=328, geen=14)
  - WR 39%, **E(R) +0,134R**, CI [+0,011; +0,263]
  - **OOS (vóór jun 2026):** n=399, WR 40%, **E(R) +0,162R, CI [+0,015; +0,309]** ← ondergrens > 0
  - IS (jun–nov 2026): n=151, E(R) +0,060R, CI [−0,161; +0,302] — IS zwakker (verwacht: rules hier ontwikkeld)
  - Per richting: bullish +0,123R, bearish +0,158R — beide positief
  - Per jaar: 2025 +0,149R (n=289); 2026 +0,113R (n=261) — consistent
  - OOS trend-up: n=343, E(R) +0,164R; OOS trend-down: n=56, E(R) +0,150R
- **Vergelijking H2 vs H6:** H2 n=838 E(R)+0,106R CI[+0,007;+0,205] → H6 n=550 E(R)+0,134R CI[+0,011;+0,263]. De D1-trendfilter schrapt range-trades en verhoogt E(R) met +0,028R.
- **Status: BEWEZEN.** Voldoet aan alle 6 criteria: ≥2 jaar data ✓, OOS positief ✓, één trade tegelijk ✓, E(R) na $0,70 kosten ✓, OOS CI-ondergrens > 0 ✓, parameters pre-specified ✓.

## Gevonden fouten (en status)
- Filterdrempels stonden alleen in prompts → LLM bepaalde zelf of ze golden. **Gefixt** (8126b1c): harde blokkades in agentAnalysis.
- Haiku zet SL/TP aan de verkeerde kant (6,7% in backtest; live o.a. 25-11 01:33 en #824). **Gefixt** (f26fb07): harde richting-check.
- Variant B (entry-zone) was identiek aan A: Haiku geeft altijd "directe markt-entry" → zone = huidige prijs. Zone-test is daardoor zinloos.
- boardroomBacktest schreef naar data/live/. **Gefixt** (67454f9).
- Lookahead-bias in D1/W1/H4: `c.time <= candle.time` liet de lopende dag/week door. **Gefixt** (bf425dc): open_time + duur ≤ H1-sluittijd. Eerdere H2-resultaten waren ~+0,05R te hoog.
- Het daggemaximum/cooldown zit alleen in het geheugen en reset bij elke redeploy.

## Forward test (live, papier)
- Gestart: 25-11-2026, Railway, Haiku 4.5, label FORWARD-TEST
- Stopregel: na ≥40 trades met E(R) < 0 na kosten → stop
- Nog te doen: foutief signaal van 25-11 01:33 markeren met `node scripts/markOnbruikbaar.js --sl 3524 --signal bearish` (op Railway)
- Let op: zolang H1 verworpen is, test deze forward test een systeem zonder aangetoonde edge. Overwegen om over te stappen op H2/H3 zodra die bewezen zijn.

## Besluitenlog
- 25-11-2026: Haiku 4.5 live als forward test op papier (geen echt geld, geen FTMO).
- 25-11-2026: CEO-zekerheid 55%, ATR-minimum $8 (Fase 102), bevestigd door Mr.T.
- 25-11-2026: H6 bewezen (OOS E(R)+0,162R, CI[+0,015;+0,309]). Eerste bewezen edge in dit systeem. Vervolgvraag: H3 (hybride boardroom-filter) als verdere verbetering op H6?
