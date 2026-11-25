# MRTFX — Onderzoekslogboek

Eén bron van waarheid: wat is getest, wat is de uitslag, wat is besloten.
Bijgehouden door Claude (reviewer). Claude Code: lees dit vóór elke backtest, filterwijziging of claim over winstgevendheid.

## Wat telt als "bewezen"
Een edge is pas bewezen als ALLE punten kloppen:
1. ≥ 2 jaar data, met uitsplitsing per jaar, richting en regime
2. Positief **out-of-sample** (periode vóór de ontwikkeling/afstelling van de regels)
3. Maximaal één open trade tegelijk (geen overlappende triggers)
4. E(R) na kosten ($0,70/trade of meer), gemeten in echte rMultiple — nooit met een aangenomen R:R
5. Ondergrens van het 95%-interval van E(R) > 0 — vanaf 5+ geteste hypotheses: het **99%-interval**
7. Beter dan een **random-benchmark** (willekeurige entries met dezelfde richting-/SL-/TP-regels) — anders zit de edge niet in de entry-regels
6. Geen parameters geoptimaliseerd op dezelfde data

Alles wat hier niet aan voldoet heet "hypothese" of "indicatie", nooit "bewezen" of "statistisch significant".

## Teller
Aantal geteste hypotheses: **10** (H1–H7, TP2-variant, random-benchmark, H7 op 2 tijdstippen) — gebruik voortaan het 99%-interval als drempel
Bewezen hypotheses: **0** — H6 teruggezet naar KANDIDAAT (CI99 snijdt nul; H3 VERWORPEN 25-11-2026)

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


### H3 — Hybride: boardroom beslist alleen ja/nee, SL/TP mechanisch via ATR — VERWORPEN (25-11-2026)

**Hypothese:** De boardroom verbetert E(R) als ja/nee-filter, ook al levert die geen betere SL/TP dan ATR.

**Setup:** 636 mechanische triggers (25 mei–25 nov 2026). Boardroom (Haiku 4.5, concurrency 4) beslist ja/nee per trigger; SL/TP = 1,5×ATR en 2×ATR of 3×ATR, niet door boardroom bepaald. Noot: laatste 26 triggers (19–20 nov) zijn niet beoordeeld door boardroom wegens onvoldoende API-credits.

**Uitslag:**

| Variant | n | WR | E(R) |
|---|---|---|---|
| Mech SL×1.5 / TP×2 | 636 | 47% | +0,076R |
| Mech SL×1.5 / TP×3 | 636 | 38% | **+0,118R** |
| Hybride SL×1.5 / TP×2 | 298 | 46% | +0,055R |
| Hybride SL×1.5 / TP×3 | 298 | 34% | +0,007R |
| Boardroom origineel (H1) | 364 | 38% | +0,019R |

- Boardroom doorgelaten: 298/636 = 47%. De overige 338 triggers werden geblokkeerd — dit waren gemiddeld de **betere** trades (mech 636 E(R)+0,118R > hybride 298 E(R)+0,007R).
- Trend-down regime: mech TP×3 geeft +0,445R (n=120), hybride TP×3 slechts −0,34R (n=13). De boardroom blokkeert vrijwel alle trend-down trades — precies de beste categorie.
- Totaal rendement: mech 636 × +0,118R = 75R; hybride 298 × +0,007R = 2R. De boardroom vernietigt bijna al het voordeel.

**Besluit: VERWORPEN.** De boardroom als ja/nee-filter voegt geen waarde toe; hij verwijdert juist de meest winstgevende triggers. Lijn met CLAUDE.md "beslisregel: voegt boardroom geen E(R) toe → boardroom eruit." De boardroom-architectuur blijft aanwezig als optie, maar de hybride aanpak heeft geen statistische grondslag meer.

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

### H6 — H2 met D1-trendfilter (alleen met de trend) — **KANDIDAAT, niet bewezen (Claude-review 25-11-2026)**
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
- **Claude-review (25-11-2026, `lab-claude/h6check.js`, onafhankelijk herberekend):**
  - Herhaald: 550 trades, OOS 399. Inclusief 'geen'-trades (timeouts; die telde hypothesisTest niet mee): E(R) +0,147R, OOS +0,178R.
  - **Correctie voor meervoudig testen** (≥7 varianten getest → 99%-interval): OOS [−0,003; +0,366], totaal [−0,014; +0,309] → ondergrens nét onder nul.
  - **Kostenstress:** $1,50/trade → OOS +0,142R, 95%-CI [+0,010; +0,283] (houdt); $2,50 → OOS +0,097R, CI [−0,044; +0,240] (houdt niet).
  - **Random-benchmark (belangrijkste bevinding):** willekeurig getimede entries in de D1-trendrichting met dezelfde SL/TP geven gemiddeld **+0,113R (OOS +0,129R)** over 30 runs. H6 doet het beter dan 93% van die runs (OOS 90%). → Het grootste deel van de edge komt van **handelen in de richting van de D1-trend**, niet van de conditionChecker-triggers (die voegen ~+0,03–0,05R toe, niet aantoonbaar).
  - Let op: hypothesisTest geeft `h4Candles: []` mee aan checkConditions → trend-modus staat uit; de geteste triggers zijn niet identiek aan het live systeem.
  - Periode nov 2024–nov 2026 was voor goud sterk trendmatig (historische rally). Een trendvolgende edge moet bewezen worden op langere historie (incl. zijwaartse jaren) en andere markten.
- **Oorspronkelijke status door Claude Code: "BEWEZEN"** — teruggezet naar KANDIDAAT om bovenstaande redenen.
- Oorspronkelijke onderbouwing:
  Voldoet aan alle 6 criteria: ≥2 jaar data ✓, OOS positief ✓, één trade tegelijk ✓, E(R) na $0,70 kosten ✓, OOS CI-ondergrens > 0 ✓, parameters pre-specified ✓.


### H7 — Simpelste trendvolger: dagelijkse entry op vast tijdstip in D1-trendrichting — OPEN

**Regels:** één entry per dag op vast tijdstip in D1-trendrichting (SMA50-regime ±0,2%), range = geen trade; SL 1,5×ATR, TP 3×ATR; één trade tegelijk.

**Eerdere test (2 jaar goud, `lab-claude/h7check.js`, nov 2024–nov 2026):**
- 08:00 UTC: n=438, E(R) +0,031R, 99%-CI [−0,138; +0,206]
- 13:00 UTC: n=393, E(R) +0,119R, 99%-CI [−0,066; +0,302]

**Uitbreiding: 20+ jaar D1-data, 5 instrumenten (`scripts/multiMarketTest.js`, 25-11-2026)**
Data: Yahoo Finance (GC=F, SI=F, EURUSD=X, ^NDX, ^GDAXI), jan 2003–nov 2026.
Variant H7-D1: entry op D1-open van de volgende candle na D1-trendsignaal (SL/TP op D1-ATR).
Kosten: XAU/USD → $0,70/slDist; overig → 0,019R (genormaliseerd).

| Instrument | n    | WR  | E(R)     | CI99 (OOS)                   |
|-----------|------|-----|----------|------------------------------|
| XAU/USD   | 398  | 36% | +0,070R  | [−0,118; +0,263] OOS n=389  |
| XAG/USD   | 416  | 35% | +0,034R  | [−0,162; +0,208] OOS n=408  |
| EUR/USD   | 310  | 35% | +0,034R  | [−0,165; +0,273] OOS n=302  |
| NAS100    | 470  | 35% | +0,022R  | [−0,145; +0,188] OOS n=463  |
| GER40     | 481  | 34% | −0,002R  | [−0,163; +0,172] OOS n=468  |
| Portfolio | 2054 | —   | +0,030R  | CI99 [−0,052; +0,110]       |

- **Random benchmark XAU/USD (50 runs):** gemiddeld E(R) +0,073R (random). H7-D1 XAU E(R) = +0,070R → beter dan **48%** van random runs. **H7-D1 is statistisch niet te onderscheiden van willekeurige entries in de D1-trendrichting.**
- Bullish/bearish-asymmetrie: bullish +0,15–0,31R, bearish −0,16–0,34R. De "edge" is volledig afhankelijk van de seculiere opwaartse trend in goud en aandelen 2003–2026. In een neerwaartse trend keert de edge om.

**Uitbreiding: 2-jaar H1-data, 5 instrumenten (08:00 + 13:00 UTC)**

| Instrument | n    | WR  | E(R)      | CI99 OOS              |
|-----------|------|-----|-----------|----------------------|
| XAU/USD   | 554  | 32% | −0,068R   | [−0,224; +0,149]     |
| XAG/USD   | 631  | 31% | −0,090R   | [−0,276; +0,064]     |
| EUR/USD   | 500  | 34% | −0,013R   | [−0,227; +0,141]     |
| NAS100    | 293  | 32% | −0,057R   | [+0,040; (OOS only)] |
| GER40     | 482  | 34% | −0,008R   | [−0,201; +0,204]     |
| Portfolio | 2395 | —   | −0,049R   | CI99 [−0,120; +0,026]|

- 08:00 UTC: E(R) −0,089R; 13:00 UTC: E(R) +0,024R (XAU/USD). Verschil = 0,113R bij n≈400 → ruimschoots niet significant (CI's overlappen).
- **Status: OPEN.** Geen enkel instrument of tijdstip voldoet aan alle 7 bewijs-criteria. Random benchmark toont aan dat de edge van H7-D1 voortkomt uit de D1-trendrichting zelf, niet uit de entry-regels.


## FTMO-simulatie (Claude, 25-11-2026, `lab-claude/mc.js`)
Monte Carlo (20.000 runs) op de H6-trades (≈22 trades/maand), FTMO 2-step: Fase 1 +10%, Fase 2 +5%, max verlies 10% (daglimiet niet bindend bij één trade tegelijk en ≤1,5% risico).
| Scenario | Risico/trade | Fase 1 slaagt | Fase 2 slaagt | Beide (≈) | Mediaan Fase 1 |
|---|---|---|---|---|---|
| Volle edge (+0,147R) | 1% | 82% | 86% | ~70% | 1,6 mnd |
| Halve edge (+0,073R) | 1% | 67% | 77% | ~52% | 1,8 mnd |
| Geen edge (0R) | 1% | 49% | 64% | ~31% | 1,8 mnd |
- Les: ook **zonder** edge haalt ~31% beide fases puur door geluk. Een geslaagde challenge is dus géén bewijs van een edge — alleen een lange reeks trades is dat.
- Inkomensindicatie funded $100k, 1% risico ($1.000/R), 80% split: halve edge ≈ 1,6R/mnd ≈ $1.300/mnd; volle edge ≈ 3,2R/mnd ≈ $2.600/mnd — met grote maandelijkse schommelingen.

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
- 25-11-2026: H6 aanvankelijk "bewezen", teruggezet naar KANDIDAAT na 99%-CI-correctie (OOS CI99[−0,032; +0,368] snijdt nul). Eerste echte kandidaat, maar niet aan alle criteria.
- 25-11-2026: H3 VERWORPEN — boardroom als ja/nee-filter vernietigt edge (mech +0,118R → hybride +0,007R bij TP×3). Boardroom niet gebruiken als filter; mechanische triggers zijn beter zonder boardroom.
- 25-11-2026: H7 uitgebreid naar 20+ jaar, 5 instrumenten. D1-trendrichting geeft licht positieve E(R) maar ononderscheidbaar van random entries (+48% van random). Edge zit in trendrichting, niet in entry-regels.
- 25-11-2026: Meest veelbelovende vervolgstap: 10+ jaar H1-data voor XAU/USD nodig om H6 met voldoende power te testen. Vereist Twelve Data Grow-plan of alternatieve databron.
