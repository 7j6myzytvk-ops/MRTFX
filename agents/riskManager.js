import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { atr } from './indicators.js';

const RISK_TOOL = {
  name: 'bepaal_risico',
  description: 'Sla het risicobeheer-advies vast.',
  input_schema: {
    type: 'object',
    properties: {
      entryZone: { type: 'string', description: 'Concrete entry-zone als prijsrange, bv. "$4100–$4108". Bij te late entry: "Wacht op pullback naar $4100–$4108".' },
      stopLoss: { type: 'number', description: 'Voorgestelde stop-loss prijs.' },
      takeProfit: { type: 'number', description: 'Voorgestelde take-profit prijs.' },
      positionSize: { type: 'string', enum: ['klein', 'normaal', 'groot'] },
      reasoning: { type: 'string', description: 'Korte onderbouwing in het Nederlands (2-3 zinnen).' },
    },
    required: ['entryZone', 'stopLoss', 'takeProfit', 'positionSize', 'reasoning'],
  },
};

export async function assessRisk(
  candles,
  analysis,
  { instrument = 'XAU_USD', granularity = 'H1', events = [], newsContext = '', contextNotes = '', streakNote = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const lastClose = candles[candles.length - 1].close;
  const atr14 = atr(candles.slice(-50), 14) ?? 0;

  const eventsNote = events.length
    ? `\n\nLet op: binnen 48 uur staan de volgende belangrijke USD-economische events gepland: ` +
      events.map((e) => `"${e.name}" om ${e.time}`).join(', ') +
      `. Houd rekening met verhoogde volatiliteit rond deze tijdstippen bij je SL/TP- en ` +
      `positiegrootte-advies.`
    : '';

  const newsContextNote = newsContext
    ? `\n\nLet op: het team heeft de volgende actuele marktcontext meegegeven (behandel als ` +
      `bevestigd feit): "${newsContext}". Houd rekening met mogelijk verhoogde volatiliteit ` +
      `hierdoor bij je SL/TP- en positiegrootte-advies.`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 768,
    tools: [RISK_TOOL],
    tool_choice: { type: 'tool', name: RISK_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een senior institutioneel risicomanager met 12 jaar ervaring op een prop-trading ` +
          `desk gespecialiseerd in edelmetalen. Je hebt in die tijd meer dan 3.000 goud-trades ` +
          `beoordeeld op risico. Je kent de valkuilen van XAU/USD van binnenuit: de gefaked breakouts, ` +
          `de overnight-gaps bij geopolitieke events, de stop-hunt-zones rond ronde $50-niveaus. ` +
          `Jouw exclusieve mandaat: de exacte technische parameters van de trade bepalen — entry-zone, ` +
          `SL, TP en positiegrootte. Je geeft GEEN directioneel oordeel en GEEN marktmening — ` +
          `dat is de taak van andere agents. Jij beantwoordt één vraag: ` +
          `"Als we dit signaal willen handelen, hoe doen we dat technisch verantwoord?"\n\n` +

          `Situatie: ${instrument} (${granularity}), huidige prijs ${lastClose}.\n` +
          `Analist-signaal: "${analysis.signal}" (zekerheid ${analysis.confidence}%)\n` +
          `Setup-kwaliteitsscore: ${analysis.setupQualityScore ?? '?'}/6 criteria aanwezig\n` +
          `Onderbouwing: "${analysis.reasoning}"\n` +
          `ATR14 (H1, periode 14): $${atr14.toFixed(2)}\n\n` +

          `ENTRY-ZONE (nieuw — vermeld dit expliciet in je reasoning):\n` +
          `• Leid uit de analist-onderbouwing het meest logische entry-niveau af: het dichtstbijzijnde ` +
          `onaangetaste Order Block (OB) of Fair Value Gap (FVG) in de signaalrichting\n` +
          `• Geef een concrete prijsrange: "Optimale entry-zone: $X–$Y"\n` +
          `• Als de huidige prijs al diep in de beweging zit (ver van OB/FVG): meld dat de entry ` +
          `"te laat" is en adviseer 'klein' of wacht op een pullback\n\n` +

          `SL/TP KENNIS:\n` +
          `• Ronde $50-niveaus ($3250, $3300, $3350...) zijn magneten — SL VOORBIJ zo'n niveau, ` +
          `nooit vlak ervoor (stop hunt risico)\n` +
          `• SL minimaal 0.5× ATR14 verwijderd van huidige prijs\n` +
          `• TP realistisch voor 13:00–17:00 UTC NY-sessie: 2–2.5× ATR14\n` +
          `• R:R streefniveau: 2.0. Dit is het bewezen optimum voor zowel bullish (EV=0.345) als ` +
          `bearish signalen (EV=0.448). Vermijd 2.5 specifiek — backtest toont EV-dip op dat ` +
          `niveau (0.207) door liquiditeitsstop-zones bij 2.5× ATR. Acceptabel bereik: 1.5–2.0. ` +
          `Boven 2.5 alleen als er een duidelijke technische reden is (OB/FVG verder weg)\n\n` +

          `POSITIEGROOTTE (confidence × kwaliteit — pas in deze volgorde toe):\n` +
          `• Harde blokkade: setup-kwaliteitsscore <3 → altijd 'klein', skip verdere berekening\n` +
          `• Basislijn op analist-zekerheid: <65% → klein | 65-70% → normaal | >70% → groot\n` +
          `• Kwaliteitskorting (elk van onderstaande verlaagt één stap, minimum 'klein'):\n` +
          `  – ATR14 < $13: markt te kalm, SL/TP-niveaus onbetrouwbaar → één stap omlaag\n` +
          `  – ATR14 > $30: extreme volatiliteit, verhoogd gap-risico → één stap omlaag\n` +
          `  – Entry te laat of geen logisch SL/TP niveau: altijd 'klein'\n` +
          `• Kwaliteitsbonus (alle drie vereist, verhoogt één stap, maximum 'groot'):\n` +
          `  – setupQualityScore ≥ 5/6 ÉN ATR14 ≥ $13 ÉN zekerheid ≥ 70%\n` +
          `• Vermeld in reasoning: basislijn, eventuele korting/bonus, eindadvies.\n` +
          `  Voorbeeld: "Basislijn groot (72%), ATR14 $18 > $13 geen korting, score 5/6 bonus → GROOT"\n` +
          `  Voorbeeld: "Basislijn normaal (67%), ATR14 $11 < $13 één stap omlaag → KLEIN"` +
          `${eventsNote}${newsContextNote}${streakNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
