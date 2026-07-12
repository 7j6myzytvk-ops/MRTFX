import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

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

function averageRange(candles) {
  const ranges = candles.map((c) => c.high - c.low);
  return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
}

export async function assessRisk(
  candles,
  analysis,
  { instrument = 'XAU_USD', granularity = 'H1', events = [], newsContext = '', contextNotes = '', streakNote = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const lastClose = candles[candles.length - 1].close;
  const avgRange = averageRange(candles);

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
          `Gem. candle-range (ATR-proxy) over ${candles.length} candles: ${avgRange.toFixed(2)}\n\n` +

          `ENTRY-ZONE (nieuw — vermeld dit expliciet in je reasoning):\n` +
          `• Leid uit de analist-onderbouwing het meest logische entry-niveau af: het dichtstbijzijnde ` +
          `onaangetaste Order Block (OB) of Fair Value Gap (FVG) in de signaalrichting\n` +
          `• Geef een concrete prijsrange: "Optimale entry-zone: $X–$Y"\n` +
          `• Als de huidige prijs al diep in de beweging zit (ver van OB/FVG): meld dat de entry ` +
          `"te laat" is en adviseer 'klein' of wacht op een pullback\n\n` +

          `SL/TP KENNIS:\n` +
          `• Ronde $50-niveaus ($3250, $3300, $3350...) zijn magneten — SL VOORBIJ zo'n niveau, ` +
          `nooit vlak ervoor (stop hunt risico)\n` +
          `• SL minimaal 0.5× avg range verwijderd van huidige prijs\n` +
          `• TP realistisch voor 13:00–17:00 UTC NY-sessie: 2–3× avg range\n` +
          `• R:R primair streefniveau: 2.0 (EV-piek combo: 0.342). Alternatief: 3.0 bij bearish ` +
          `signalen (bearish EV bij 2.0 = 0.500, bij 3.0 = 0.444). Vermijd 2.5 — backtest toont ` +
          `EV-dip op dat niveau (0.289) door liquiditeitsstop-zones bij 2.5× ATR. Onder 1.5 = ` +
          `onvoldoende risico/winst-verhouding\n\n` +

          `POSITIEGROOTTE:\n` +
          `• <60% zekerheid → klein\n` +
          `• 60-70% → normaal\n` +
          `• >70% → groot, TENZIJ avg range > 30 → dan één stap lager (te volatiel)\n` +
          `• Setup-kwaliteitsscore <3 (zie hierboven) → altijd 'klein', ongeacht het zekerheidspercentage\n` +
          `• Als geen verantwoorde entry mogelijk (SL te groot, geen logisch TP, te laat in beweging): ` +
          `adviseer 'klein' en leg dit uit in je reasoning.` +
          `${eventsNote}${newsContextNote}${streakNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
