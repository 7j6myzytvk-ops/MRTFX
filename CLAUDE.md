# MRTFX — Projectinstructies voor Claude

## Doel
Volledig geautomatiseerd XAU/USD trading systeem dat live setups detecteert, via Discord doorstuurt, en daadwerkelijk take profits raakt.

## Zelfcheck — verplicht periodiek uitvoeren
Na elke reeks implementaties (elke 3-5 taken of na een significante wijziging) stel ik mezelf deze vragen voordat ik verdergaat met de volgende taak:

1. **Heb ik alles gedaan wat mogelijk is om dit systeem winstgevend te maken?**
2. Zijn er fundamentele gaps die ik ken maar nog niet heb benoemd of aangepakt?
3. Ben ik reactief bezig (alleen uitvoeren wat gevraagd wordt) of proactief (signaleren wat nog ontbreekt)?
4. Wat is de zwakste schakel in het systeem op dit moment?

Als ik één van deze vragen niet met vertrouwen kan beantwoorden, benoem ik dat expliciet aan de gebruiker — zonder dat zij ernaar hoeven te vragen.

## Parameter-freeze (actief vanaf 31 jul 2026)
Het systeem heeft voldoende aanpassingen gehad. **Verander geen filter-drempels, cooldowns of kwaliteitsregels meer** op basis van losse signalen of korte reeksen (<20 trades). De volgende parameters zijn bevroren:
- Rebuttal-drempel: -35%
- ATR-minimum: $8
- DA-blocker: >82%
- Setup-score minimum: ≥3 (≥4 voor counter-W1)
- R:R-ondergrens: 1.0
- CEO-zekerheid minimum: 50%

Uitzondering: pas na ≥100 doorgekomen live signalen opnieuw evalueren, en alleen bij een duidelijk statistisch patroon (niet bij 1-2 uitschieters). Als de gebruiker een parameter wil aanpassen op basis van <20 trades, benoem ik dit als risico.

## Bekende zwakke schakels (bijhouden en aanpakken)
- Analist-prompt: ICT-criteria (sweep, OB, CHoCH) moeten scherper gedefinieerd zijn
- Systematische validatie: elke 2 weken terugkijken op signalen en uitkomsten na de freeze

## Architectuur
- 6 agents: analist → parallel[riskManager, DA, macroAnalist, geopolitiek] → rebuttal → CEO
- Reversal-modus: 6 ICT-criteria (①-⑥), score ≥3 vereist
- Trend-modus: 4 criteria (①-④), score ≥3 vereist
- Kwaliteitsfilters in agentAnalysis.js (CEO-zekerheid, macro, R:R, ATR, overextended, setup-score)
- Live op Railway, Discord-notificaties via bot.js
