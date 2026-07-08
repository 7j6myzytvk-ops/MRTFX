# Concept: verdere verdieping agent-prompts (NIET TOEGEPAST)

Status: concept, ter review na de eerste live-resultaten. Geen van deze
wijzigingen is doorgevoerd in `agents/*.js`. Dit document bestaat om
voorstellen vast te houden zonder de lopende live-validatie te verstoren.

Uitgangspunt: geen nieuwe agents, geen overlap — alleen de bestaande zes
stemmen dieper specialiseren waar een echte veteraan iets zou doen dat de
huidige prompt nog niet afdwingt.

---

## 1. Marktstructuur-analist (`agents/analyst.js`)

**Gat: geen Power of Three (AMD) op daginterpretatie.**
ICT's "Accumulation-Manipulation-Distribution"-model voorspelt het ritme van
een handelsdag (range vroeg, sweep, dan de echte move). Dit ontbreekt nu
volledig — de analist beoordeelt structuur zonder dit dagprofiel te duiden.
Voorstel: extra regel onder STRUCTUURANALYSE die vraagt te classificeren in
welke AMD-fase de huidige candle-sessie zich bevindt, en of de "manipulatie"
(judas swing) al heeft plaatsgevonden vóór de beoogde entry.

**Gat: vage invalidatie.**
"Het concrete prijs-invalidatieniveau" wordt nu gevraagd, maar niet afgedwongen
als exact getal. Voorstel: schema-veld toevoegen (`invalidationLevel: number`)
zodat het niet wegzakt in vrije tekst — net zoals `setupQualityScore` een
afdwingbaar veld werd in Fase 36c.

---

## 2. Risicomanager (`agents/riskManager.js`)

**Gat: geen weekend-/sessie-overgangsrisico.**
XAU/USD gapt over het weekend en bij DST-overgangen. Een SL die "technisch
correct" is op vrijdagmiddag kan door een weekend-gap alsnog geraakt worden
zonder dat de structuur ooit echt is gebroken. Voorstel: regel toevoegen die
positiegrootte verlaagt bij open posities die het weekend in zouden gaan.

**Gat: geen spread/slippage-marge.**
SL/TP worden nu als exacte niveaus berekend zonder marge voor spread bij
news-events. Voorstel: kleine buffer-regel bij hoge ATR (avgRange) of
naderende eventsNote.

---

## 3. Pre-mortem specialist / Devil's Advocate (`agents/devilsAdvocate.js`)

**Geen gat gevonden dat de moeite waard is.** De 5-scenario's + calibratieschaal
zijn al expliciet en goed afgedwongen. Verdere toevoeging zou risico op
overlap met de analist-rebuttal geven (dubbel werk, tegen de
fundament-first-richtlijn).

---

## 4. Macro & Momentum analist (`agents/macroAnalyst.js`)

**Gat: geen concreet historisch analogon-mechanisme.**
De prompt noemt wel periodes (2001-2011, 2011-2018, 2022-2026) maar vraagt
niet expliciet om het huidige regime te spiegelen aan een specifiek historisch
moment ("dit lijkt op augustus 2019, toen reële rente daalde terwijl dollar
hield"). Dat soort patroonherkenning is precies wat 20 jaar ervaring toevoegt
boven een generieke regime-classificatie. Voorstel: vraag in de prompt om
expliciet één historisch analogon te benoemen en te zeggen hoe de huidige
situatie daarvan afwijkt.

---

## 5. Geopolitiek & Timing analist (`agents/geopoliticalAnalyst.js`)

**Gat: geen decay-modelering van nieuws.**
"Sell the news"-risico wordt genoemd, maar er is geen expliciete vraag naar
hoe oud/"verbruikt" een nieuwsitem is. Een bericht van 3 uur oud heeft andere
impact dan een dat al 36 uur in de markt verwerkt is. Voorstel: vraag de
agent om bij elke keyEvent een geschatte "hoeveel is dit al ingeprijsd"-score
te geven (vers / deels verwerkt / grotendeels ingeprijsd).

---

## 6. CEO (`agents/ceo.js`)

**Geen gat gevonden.** Persona, kernprincipe, gewichten, kalibratie en vaste
drempels zijn compleet en intern consistent. Verdere toevoeging hier zou het
besluitvormingsproces alleen maar complexer maken zonder duidelijke winst.

---

## Volgorde van toepassen (als ervoor gekozen wordt)

Als na de live-resultaten besloten wordt om dit door te voeren: begin met de
schema-velden (`invalidationLevel`, decay-score) — die zijn het makkelijkst
algoritmisch te valideren via `signalValidator.js`, net als
`setupQualityScore` in Fase 36c. Pas daarna de vrije-tekst-uitbreidingen
(AMD-fase, historisch analogon) — die zijn lastiger te testen en hebben meer
kans op prompt-bloat als ze niet scherp worden geformuleerd.
