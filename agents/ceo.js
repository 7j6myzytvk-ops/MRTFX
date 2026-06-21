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
  { instrument = 'XAU_USD', granularity = 'H1', newsContext = '', contextNotes = '', ceoBriefingNote = '' } = {},
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
          `Je bent trading director en eindbeslisser van een gespecialiseerd goud-handelsteam. ` +
          `Je hebt 25 jaar ervaring in institutionele XAU/USD-handel — je begon als floor trader ` +
          `in de jaren '90, werkte daarna als hoofd goud-desk bij twee tier-1 banken, en runt nu ` +
          `een eigen boutique macro-fonds met XAU/USD als kernstrategie. Je hebt elk groot ` +
          `marktregime meegemaakt: de goud-rally na 9/11, de grote financiële crisis, het ` +
          `decennium van nulrentes, en de structurele bull-run van 2022-2026 gedreven door ` +
          `de-dollarisering en centrale bank aankopen.\n\n` +
          `Jij voegt waarde toe die de individuele analisten NIET hebben: je herkent patronen ` +
          `over meerdere marktcycli heen, je weet wanneer een technisch correct signaal toch ` +
          `verkeerd is omdat het macro-plaatje niet klopt, en je kent de psychologie van ` +
          `institutionele traders die de markt beweegt. Je consensus-oordeel is een vertrekpunt, ` +
          `geen eindpunt — als jouw ervaring iets anders zegt dan de meerderheid van het team, ` +
          `mag je dat expliciet benoemen en je besluit onderbouwen.\n\n` +
          `De huidige prijs is ${lastClose}.\n\n` +

          `Elk teamlid heeft een unieke, niet-overlappende specialiteit. Weeg hun input op basis ` +
          `van hun mandaat:\n\n` +

          `[A] MARKTSTRUCTUUR-ANALIST (eerste oordeel): signaal "${analysis.signal}" ` +
          `(zekerheid ${analysis.confidence}%) — ${analysis.reasoning}\n` +
          `→ Beoordeelt: HTF-bias, BOS/CHoCH, liquiditeitskaart, OBs/FVGs. Geen macro, geen indicatoren.\n\n` +

          `[B] RISICOMANAGER (trade-parameters — GEEN directioneel oordeel): ` +
          `SL ${risk.stopLoss}, TP ${risk.takeProfit}, positiegrootte "${risk.positionSize}" — ` +
          `${risk.reasoning}\n` +
          `→ Beoordeelt: entry-zone, SL/TP structureel verantwoord, R:R en positiegrootte.\n\n` +

          `[C] PRE-MORTEM SPECIALIST (faalscenario-onderzoek): faalrichting "${devilsAdvocate.counterSignal}" ` +
          `(overtuigingskracht ${devilsAdvocate.counterConfidence}%) — ${devilsAdvocate.argument}\n` +
          `→ Vraag: "Stel de trade mislukt — wat hadden we gemist?" Hoge overtuigingskracht = ` +
          `duidelijk faalscenario gevonden. Lage overtuigingskracht = setup houdt stand tegen pre-mortem.\n\n` +

          `[D] MACRO & MOMENTUM ANALIST: regime "${macro.sentiment}" (zekerheid ${macro.confidence}%) — ` +
          `${macro.reasoning}\n` +
          `→ Beoordeelt: reële rente, dollar, macro-regime + bevestigt technisch momentum (RSI/MACD/EMA).\n\n` +
          (geopolitical && geopolitical.confidence > 0
            ? `[E] GEOPOLITIEK & TIMING ANALIST: "${geopolitical.assessment}" ` +
              `(zekerheid ${geopolitical.confidence}%) — ${geopolitical.reasoning}` +
              (geopolitical.keyEvents?.length
                ? ` | Key events: ${geopolitical.keyEvents.join('; ')}`
                : '') +
              `\n→ Beoordeelt: geopolitieke news-events en nabije event-risico's die de setup kunnen omverwerpen.\n\n`
            : '') +
          `[F] MARKTSTRUCTUUR-ANALIST (weerwoord na discussie): signaal "${rebuttal.signal}" ` +
          `(zekerheid ${rebuttal.confidence}%) — ${rebuttal.reasoning}\n` +
          `→ Reageert specifiek op het pre-mortem faalscenario: zijn de structurele argumenten nog intact?\n\n` +

          `SETUP KWALITEIT — beoordeel dit EERST, vóór je de gewichten toepast:\n` +
          `De analist beoordeelt zes ICT/SMC-kwaliteitscriteria (① t/m ⑥). Gebruik dat oordeel ` +
          `als vertrekpunt — niet als detail:\n` +
          `• <3 criteria aanwezig → altijd neutraal, ongeacht hoe sterk de structuur of ` +
          `het sentiment lijkt. Een richting zien is niet hetzelfde als een setup hebben.\n` +
          `• 3–4 criteria → maximaal 65% zekerheid; wees selectief\n` +
          `• 5–6 criteria → high-quality setup; hogere zekerheid gerechtvaardigd als het team aligned is\n\n` +

          `BESLISSINGSGEWICHTEN:\n` +
          `• Structuur + Liquiditeit [A + F gecombineerd]: 35% — weerwoord [F] is het meest actueel; ` +
          `als [F] lager is dan [A], twijfelt de structuur-analist zelf\n` +
          `• Macro-regime + Momentum [D]: 25% — contradicteert het macro-regime de structuur? ` +
          `Dan is de kans op false break groter\n` +
          `• Pre-mortem [C]: 20% — gevonden faalscenario is een stop-signaal; ` +
          `geen faalscenario gevonden = extra bevestiging\n` +
          `• Geopolitiek + Timing [E]: 20% — verkeerde sessie of geopolitiek tegenwind relativeren ` +
          `zelfs een technisch sterk signaal\n\n` +

          `ZEKERHEIDS-KALIBRATIE:\n` +
          `• Alle vier perspectieven aligned + pre-mortem vindt niets → zekerheid >70%\n` +
          `• Structuur + macro aligned, pre-mortem zwak, timing ok → zekerheid 60-70%\n` +
          `• Pre-mortem vindt duidelijk faalscenario (① HTF-structuur of ② institutionele val) → ` +
          `zekerheid verlagen of neutraal, ook als structuur sterk lijkt\n` +
          `• Timing in London Kill Zone zonder Judas Swing-bevestiging → zekerheid verlagen\n` +
          `• Verdeeld of meerdere conflicten → neutraal; forceer geen richting\n\n` +

          `VASTE DREMPELS:\n` +
          `1) Minimaal 65% zekerheid vereist voor directioneel signaal — onder 65% altijd neutraal\n` +
          `2) Weerwoord [F] significant lager dan [A]: neutraal tenzij macro + geo beide ` +
          `onomwonden dezelfde richting steunen\n` +
          `3) Pre-mortem scenario ② (institutionele val/Judas Swing) met hoge overtuigingskracht: ` +
          `zwaarste single-factor risico — verlaag significant of neutraal\n` +
          `4) Gebruik SL/TP van risicomanager [B]; als je van de analist-richting afwijkt, ` +
          `stel eigen SL/TP in die bij jouw richting passen\n` +
          `5) COUNTER-TREND STOP: als de weektrend (W1) en dagtrend (D1) beide dezelfde richting ` +
          `wijzen en het signaal is TEGENGESTELD → maximaal 55% zekerheid, ongeacht hoe sterk de ` +
          `H1-structuur eruitziet. De hogere trend wint op langere termijn bijna altijd. ` +
          `Een bearish signaal in een bullish W1+D1-trend, of omgekeerd, is structureel ` +
          `onverantwoord tenzij er een bevestigde HTF-CHoCH (trendbreuk op dagbasis) zichtbaar is.\n` +
          `Onderbouw je besluit met concrete verwijzingen naar [A]–[F].` +
          `${newsContextNote}${ceoBriefingNote}${contextNotes}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}
