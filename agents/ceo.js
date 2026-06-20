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
    max_tokens: 1024,
    tools: [DECISION_TOOL],
    tool_choice: { type: 'tool', name: DECISION_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent de CEO van een handelsteam voor ${instrument} (${granularity}-candles). ` +
          `De huidige prijs is ${lastClose}. Je team leverde de volgende invalshoeken:\n\n` +
          `1) Technische analyse: signaal "${analysis.signal}" (zekerheid ${analysis.confidence}%) - ` +
          `${analysis.reasoning}\n\n` +
          `2) Risicobeoordeling (sizing en niveaus, geen directioneel oordeel): ` +
          `SL ${risk.stopLoss}, TP ${risk.takeProfit}, positiegrootte "${risk.positionSize}" - ` +
          `${risk.reasoning}\n\n` +
          `3) Tegenscenario: signaal "${devilsAdvocate.counterSignal}" ` +
          `(zekerheid ${devilsAdvocate.counterConfidence}%) - ${devilsAdvocate.argument}\n\n` +
          `4) Onafhankelijk macro/sentiment-oordeel: "${macro.sentiment}" ` +
          `(zekerheid ${macro.confidence}%) - ${macro.reasoning}\n\n` +
          (geopolitical && geopolitical.confidence > 0
            ? `5) Geopolitieke/nieuws-analyse: "${geopolitical.assessment}" ` +
              `(zekerheid ${geopolitical.confidence}%) - ${geopolitical.reasoning}` +
              (geopolitical.keyEvents?.length
                ? ` | Sleutel-events: ${geopolitical.keyEvents.join('; ')}`
                : '') +
              `\n\n`
            : '') +
          `Na de discussie herzag de technisch analist zijn standpunt: signaal "${rebuttal.signal}" ` +
          `(zekerheid ${rebuttal.confidence}%) - ${rebuttal.reasoning}\n\n` +
          `Neem nu het definitieve besluit. De directionele invalshoeken (technische analyse, ` +
          `tegenscenario, macro/sentiment${geopolitical && geopolitical.confidence > 0 ? ' en geopolitiek/nieuws' : ''}) ` +
          `wegen elk even zwaar — er is geen standaard-standpunt. ` +
          `Kalibreer je zekerheid op basis van consensus: alle drie (of vier) stemmen eensgezind → boven 70%; ` +
          `meerderheid eensgezind → 60-70%; verdeeld of sterke twijfel → neutraal. ` +
          `De risicobeoordeling (invalshoek 2) informeert je SL/TP en positiegrootte, niet de richting. ` +
          `Als jouw signaal afwijkt van de technisch analist, stel dan ook nieuwe SL/TP-niveaus in ` +
          `die bij jouw richting passen — de risicomanager's niveaus zijn berekend voor het analist-signaal. ` +
          `Onderbouw je besluit met concrete verwijzingen naar de directionele invalshoeken.\n\n` +
          `Twee extra regels op basis van bewezen patroonherkenning:\n` +
          `1) Als de technisch analist MINDER zeker werd na de discussie (weerwoord lager dan eerste ` +
          `analyse), kies dan neutraal tenzij alle overige signalen onmiskenbaar één richting aanwijzen. ` +
          `Een analist die twijfelt na kritiek is een sterk waarschuwingssignaal.\n` +
          `2) Streef naar minimaal 65% zekerheid voor een directioneel signaal. Onder 65% is neutraal ` +
          `bijna altijd het juistere besluit — een matige overtuiging levert slechte trades op.` +
          `${newsContextNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
