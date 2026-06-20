import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { formatCandles } from './formatCandles.js';

const SENTIMENT_TOOL = {
  name: 'geef_marktcontext',
  description: 'Sla de marktcontext/sentiment-inschatting vast.',
  input_schema: {
    type: 'object',
    properties: {
      sentiment: { type: 'string', enum: ['risk-on', 'risk-off', 'neutraal'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      reasoning: {
        type: 'string',
        description: 'Inschatting van het marktsentiment op basis van het prijsgedrag, in het Nederlands (2-3 zinnen).',
      },
    },
    required: ['sentiment', 'confidence', 'reasoning'],
  },
};

export async function assessSentiment(
  candles,
  _analysis,
  { instrument = 'XAU_USD', granularity = 'H1', events = [], newsContext = '', contextNotes = '' } = {},
) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 60_000 });

  const eventsNote = events.length
    ? `\n\nDaarnaast staan binnen 48 uur de volgende bevestigde USD-agendapunten gepland ` +
      `(dit zijn vaststaande feiten, geen nieuws dat je zelf moet verifiëren): ` +
      events.map((e) => `"${e.name}" om ${e.time}`).join(', ') +
      `. Geef aan of en hoe dit het huidige sentiment op korte termijn kan overschaduwen.`
    : '';

  const newsContextNote = newsContext
    ? `\n\nHet team heeft daarnaast de volgende actuele marktcontext meegegeven (behandel dit als ` +
      `een bevestigd feit, in afwijking van de instructie om geen onbevestigd nieuws te claimen): ` +
      `"${newsContext}". Geef aan hoe dit het sentiment beïnvloedt en of het koersgedrag in de ` +
      `candles hiermee overeenkomt.`
    : '';

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [SENTIMENT_TOOL],
    tool_choice: { type: 'tool', name: SENTIMENT_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een macro-econoom en kwantitatief momentum-analist met diepgaande expertise in ` +
          `edelmetalen. Je analyseert ${instrument} (${granularity}-candles). Jouw exclusieve mandaat: ` +
          `(1) het macro-regime bepalen (reële rente, dollar, sentiment) en (2) beoordelen of het ` +
          `technisch momentum dat regime bevestigt of contradicteert. Je weet niet wat de structuur-analist ` +
          `concludeerde — jij kijkt alleen naar macro én indicators.\n\n` +

          `GOUD-MACRO REGIME — vier drijfveren, ranggeschikt op historisch belang:\n` +
          `1. REËLE RENTE (sterkste driver): dalende reële rentes → bullish goud. ` +
          `Stijgende reële rentes → bearish. Gebruik de rentecontext hieronder.\n` +
          `2. DOLLAR (directe inverse correlatie): zwakke dollar → bullish; sterke dollar → bearish. ` +
          `Gebruik de EUR/USD-context hieronder als proxy.\n` +
          `3. SAFE HAVEN (nuance!): crisis → safe-haven-vraag, MAAR ook dollar-appreciatie. ` +
          `Analyseer welke kracht dominant is — als dollar hard stijgt bij paniek, neutraliseren ` +
          `die twee krachten elkaar.\n` +
          `4. INFLATIE HEDGE: hogere inflatie met ongewijzigde nominale rentes = lagere reële rentes ` +
          `= bullish. Maar agressieve renteverhogingen na inflatie = bearish.\n\n` +

          `REGIME-LABEL:\n` +
          `• Risk-on voor goud: dollar verzwakt EN reële rentes dalen → sterkste bullish combinatie\n` +
          `• Risk-off voor goud: BEIDE dollar EN reële rentes stijgen → sterkste bearish combinatie\n` +
          `• Gemengd: één van beiden tegengesteld → neutraal of lichte bias\n\n` +

          `TECHNISCH MOMENTUM ALS REGIMEBEVESTIGING — jij bent de enige agent die macro én ` +
          `indicators combineert. Beantwoord expliciet:\n` +
          `• EMA50: staat de prijs erboven (bullish) of eronder (bearish)?\n` +
          `• RSI: boven 60 in bullish regime = bevestiging; onder 40 in bullish regime = divergentie\n` +
          `• MACD: histogram boven nul = bullish momentum; onder nul = bearish; ` +
          `kruising van signaallijn = vroeg regime-shift signaal\n` +
          `• Vraag: bevestigt het technisch momentum het macro-regime — of contradicteert het?\n\n` +

          `Baseer je oordeel op (1) de dollar- en rentecontext hieronder, (2) de indicator-data ` +
          `(RSI/MACD/EMA50) uit de contextNotes, en (3) het karakter van de candles. ` +
          `Claim geen macro-events die je niet zeker weet.` +
          `${eventsNote}${newsContextNote}${contextNotes}\n\n` +
          formatCandles(candles),
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
