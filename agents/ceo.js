import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

const DECISION_TOOL = {
  name: 'neem_besluit',
  description: 'Sla het definitieve besluit van het team vast.',
  input_schema: {
    type: 'object',
    properties: {
      signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      stopLoss: { type: 'number', description: 'Definitieve stop-loss prijs.' },
      takeProfit: { type: 'number', description: 'Definitieve take-profit prijs.' },
      positionSize: { type: 'string', enum: ['klein', 'normaal', 'groot'] },
      reasoning: {
        type: 'string',
        description: 'Eindoordeel met verwijzing naar de discussie, in het Nederlands (3-5 zinnen).',
      },
    },
    required: ['signal', 'confidence', 'stopLoss', 'takeProfit', 'positionSize', 'reasoning'],
  },
};

export async function decide(
  candles,
  { analysis, risk, devilsAdvocate, macro, geopolitical = null, rebuttal },
  { instrument = 'XAU_USD', granularity = 'H1', newsContext = '', contextNotes = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const lastClose = candles[candles.length - 1].close;

  const newsContextNote = newsContext
    ? `\n\nLet op: het team heeft daarnaast de volgende actuele marktcontext meegegeven (behandel ` +
      `als bevestigd feit): "${newsContext}". Weeg dit mee in je eindbesluit.`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1536,
    tools: [DECISION_TOOL],
    tool_choice: { type: 'tool', name: DECISION_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent de CEO en eindbeslisser van een professioneel handelsteam voor ${instrument} ` +
          `(${granularity}-candles). De huidige prijs is ${lastClose}.\n\n` +

          `Je team leverde de volgende invalshoeken:\n\n` +
          `[A] Technische analyse (eerste oordeel): signaal "${analysis.signal}" ` +
          `(zekerheid ${analysis.confidence}%) — ${analysis.reasoning}\n\n` +
          `[B] Risicobeoordeling (sizing en niveaus — GEEN directioneel oordeel): ` +
          `SL ${risk.stopLoss}, TP ${risk.takeProfit}, positiegrootte "${risk.positionSize}" — ` +
          `${risk.reasoning}\n\n` +
          `[C] Bear Researcher / tegenscenario: signaal "${devilsAdvocate.counterSignal}" ` +
          `(zekerheid ${devilsAdvocate.counterConfidence}%) — ${devilsAdvocate.argument}\n\n` +
          `[D] Macro/sentiment: "${macro.sentiment}" (zekerheid ${macro.confidence}%) — ` +
          `${macro.reasoning}\n\n` +
          (geopolitical && geopolitical.confidence > 0
            ? `[E] Geopolitieke/nieuws-analyse: "${geopolitical.assessment}" ` +
              `(zekerheid ${geopolitical.confidence}%) — ${geopolitical.reasoning}` +
              (geopolitical.keyEvents?.length
                ? ` | Sleutel-events: ${geopolitical.keyEvents.join('; ')}`
                : '') +
              `\n\n`
            : '') +
          `[F] Technisch analist na discussie (weerwoord): signaal "${rebuttal.signal}" ` +
          `(zekerheid ${rebuttal.confidence}%) — ${rebuttal.reasoning}\n\n` +

          `BESLISSINGSGEWICHTEN — pas deze expliciet toe:\n` +
          `• Technische analyse (A + F gecombineerd): 40% — het weerwoord [F] is het meest relevant; ` +
          `als het weerwoord omlaag ging t.o.v. [A], weegt dit negatief (twijfeling analist = gevaar)\n` +
          `• Macro/sentiment + geopolitiek (D${geopolitical && geopolitical.confidence > 0 ? ' + E' : ''}): 30% — ` +
          `macro-tegenwind bij een bullish signaal of macro-rugwind is cruciaal\n` +
          `• Tegenscenario Bear Researcher (C): 30% — lage counter-zekerheid bevestigt het signaal; ` +
          `hoge counter-zekerheid of een concreet sterk argument VERHOOGT je risico-inschatting significant\n\n` +

          `ZEKERHEIDS-KALIBRATIE op basis van consensus (gebruik dit als anker):\n` +
          `• Alle invalshoeken eensgezind → zekerheid >70%, directioneel signaal\n` +
          `• Technisch (F) + macro eensgezind, DA-zekerheid laag → zekerheid 60-70%\n` +
          `• Technisch en macro eensgezind maar DA sterk tegenargument → 55-65%, klein formaat\n` +
          `• Verdeeld of sterke tegenstemmen → neutraal; forceer geen directioneel signaal\n\n` +

          `VASTE DREMPELS (niet te omzeilen):\n` +
          `1) Weerwoord [F] lager dan eerste oordeel [A]: kies neutraal tenzij macro én DA ` +
          `beide onomwonden jouw richting steunen\n` +
          `2) Minimaal 65% zekerheid vereist voor directioneel signaal — onder 65% altijd neutraal\n` +
          `3) Gebruik SL/TP van de risicomanager [B] als jouw signaal overeenkomt met [A]; ` +
          `als je van richting afwijkt, stel eigen SL/TP in die bij jouw richting passen\n` +
          `Onderbouw je besluit met concrete verwijzingen naar de letters [A]–[F].` +
          `${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
