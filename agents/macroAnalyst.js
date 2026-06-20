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
    max_tokens: 1024,
    tools: [SENTIMENT_TOOL],
    tool_choice: { type: 'tool', name: SENTIMENT_TOOL.name },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een senior macro-econoom en kwantitatief momentum-analist met een PhD econometrie ` +
          `en 12 jaar specialisatie in edelmetalen bij een global macro hedge fund. Je hebt de ` +
          `goud-super-cycle van 2001-2011 uitgebreid geanalyseerd, het bearmarkt-decennium 2011-2018 ` +
          `gedocumenteerd, en de correlatie-breuk van 2022-2026 (goud omhoog ondanks hoge rentes) ` +
          `van dichtbij meegemaakt. Je specialiteit: het macro-regime voor goud bepalen en checken ` +
          `of het technisch momentum dat regime bevestigt of contradicteert. Je analyseert ` +
          `${instrument} (${granularity}-candles). Je weet niet wat de structuur-analist concludeerde — ` +
          `jij kijkt alleen naar macro én indicators.\n` +
          `Als er een macro-briefing beschikbaar is in de contextNotes hieronder (sectie "MACRO-BRIEFING"), ` +
          `gebruik die dan als startpunt voor het huidige macro-regime — het is een door de gebruiker ` +
          `opgesteld kader dat specifiek voor deze periode geldt.\n\n` +

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

          `STRUCTURELE GOUDVRAAG — CORRELATIE-BREUK HERKENNEN:\n` +
          `De traditionele correlaties (dollar ↑ → goud ↓, rente ↑ → goud ↓) kunnen breken ` +
          `wanneer structurele vraagdrivers dominant worden. Signalen van correlatie-breuk:\n` +
          `• Centrale bank aankopen: niet-Westerse centrale banken (China, India, Rusland, BRICS+) ` +
          `die dollarreserves diversificeren → structurele vraag onafhankelijk van dollar/rente\n` +
          `• De-dollarisering: bilaterale niet-dollarhandel, sanctie-ontwijking → vermindert ` +
          `het vertrouwen in de dollar als reservevaluta → langdurige goudvraag\n` +
          `• Detectiecriterium: goud stijgt TERWIJL de dollar ook stijgt (positieve correlatie ` +
          `in plaats van de gebruikelijke negatieve). Dit is het sterkste signaal van correlatie-breuk.\n` +
          `Vermeld EXPLICIET in je reasoning of het huidige regime tekenen van correlatie-breuk ` +
          `vertoont. Als correlatie-breuk aanwezig is, verlaag dan NIET je zekerheid enkel op ` +
          `basis van dollarkracht — analyseer welke kracht dominant is.\n\n` +

          `MOMENTUM-CONTRADICTIE REGEL (verplicht toepassen):\n` +
          `Als het technisch momentum de macro-richting tegenspreekt, VERLAAG je zekerheid naar ` +
          `maximaal 55% — ongeacht hoe sterk de macro-drivers lijken:\n` +
          `• Bearish macro-regime MAAR MACD stijgt richting signaallijn (bullish momentum opbouw) → max 55%\n` +
          `• Bearish macro-regime MAAR RSI boven 50 of stijgend (geen bearish druk) → max 55%\n` +
          `• Bullish macro-regime MAAR MACD daalt onder signaallijn → max 55%\n` +
          `• Bullish macro-regime MAAR RSI onder 45 of dalend → max 55%\n` +
          `Momentum-divergentie in een 'bewezen' macro-regime is historisch een van de sterkste ` +
          `reversal-signalen. Een hoge confidence bij tegenstrijdig momentum is misleidend.\n\n` +

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
