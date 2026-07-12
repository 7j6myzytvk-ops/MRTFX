import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config/index.js';
import {
  getXauUsdPrice,
  getRecentRealCandles,
  getRecentEurUsdCandles,
  getRecentUsYieldCandles,
  getRecentXauD1Candles,
  getRecentXauW1Candles,
} from '../services/marketData.js';
import { checkConditions, isActiveSession, isActiveDay } from '../services/conditionChecker.js';
import { getBriefing, setBriefing, clearBriefing, formatBriefingNote } from '../services/macroBriefing.js';
import { fetchGoldNews } from '../services/newsService.js';
import { runBoardroom } from '../agents/boardroom.js';
import { reportToDiscord, formatSetupMarker, truncateForDiscord } from '../services/boardroomReporter.js';
import { getRecentSignals, getAllSignals } from '../data/store.js';
import { startSignalScheduler } from '../services/scheduler.js';
import { evaluateOpenSignals } from '../services/performanceTracker.js';
import { summarize } from '../agents/outcomeEvaluator.js';
import { checkFtmoLimits, formatFtmoStatus } from '../services/ftmoGuard.js';
import { summarizeSignalHealth, formatHealthReport, validateSignalStructure } from '../services/signalValidator.js';
import {
  getConditionLog,
  summarizeConditionLog,
  formatDiagnosticsReport,
  filterConditionLog,
  formatDayReport,
  formatHourReport,
} from '../services/conditionDiagnostics.js';

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Toon de status van het systeem en de huidige XAU/USD koers'),
  new SlashCommandBuilder()
    .setName('analyse')
    .setDescription('Laat de AI-agent de huidige XAU/USD candles analyseren')
    .addStringOption((option) =>
      option
        .setName('context')
        .setDescription('Actuele marktcontext/nieuws dat het team moet meewegen (optioneel)'),
    ),
  new SlashCommandBuilder()
    .setName('geschiedenis')
    .setDescription('Toon de laatst gegenereerde signalen')
    .addIntegerOption((option) =>
      option
        .setName('aantal')
        .setDescription('Aantal signalen (1-10, standaard 5)')
        .setMinValue(1)
        .setMaxValue(10),
    ),
  new SlashCommandBuilder()
    .setName('performance')
    .setDescription('Toon performance-statistieken: gelogde signalen vs. werkelijke uitkomst'),
  new SlashCommandBuilder()
    .setName('health')
    .setDescription('Structuurcheck: valideert de laatste signalen op schema-integriteit en logische consistentie'),
  new SlashCommandBuilder()
    .setName('diagnose')
    .setDescription('Toont welke conditie het vaakst blokkeert, of een tijdlijn per dag/uur')
    .addStringOption((option) =>
      option
        .setName('datum')
        .setDescription('Dag om te inspecteren: "vandaag", "gisteren", of YYYY-MM-DD'),
    )
    .addIntegerOption((option) =>
      option
        .setName('uur')
        .setDescription('Specifiek uur (UTC, 0-23) — vereist ook datum')
        .setMinValue(0)
        .setMaxValue(23),
    ),
  new SlashCommandBuilder()
    .setName('ftmo')
    .setDescription('FTMO risk monitor: dagelijks verlies en totale drawdown vs limieten'),
  new SlashCommandBuilder()
    .setName('briefing')
    .setDescription('Stel de macro-briefing in die alle agents meekrijgen, of bekijk de huidige briefing')
    .addStringOption((option) =>
      option
        .setName('tekst')
        .setDescription('De macro-context voor deze week (vervangt vorige briefing, geldig 7 dagen)')
    )
    .addBooleanOption((option) =>
      option
        .setName('wissen')
        .setDescription('Wis de huidige briefing')
    ),
].map((c) => c.toJSON());

function resolveDatum(datumStr) {
  const now = new Date();
  if (datumStr === 'vandaag') return now.toISOString().slice(0, 10);
  if (datumStr === 'gisteren') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(datumStr)) return datumStr;
  return null;
}

function formatOutcome(outcome) {
  if (!outcome || outcome.result === 'open') return '⏳ open';
  switch (outcome.result) {
    case 'tp':
      return `✅ TP (na ${outcome.candlesToHit} candles)`;
    case 'sl':
      return `❌ SL (na ${outcome.candlesToHit} candles)`;
    case 'geen':
      return '➖ geen';
    case 'neutraal':
      return '➖ neutraal';
    case 'onbruikbaar':
      return '⚠️ onbruikbaar';
    default:
      return '⏳ open';
  }
}

export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commands },
  );
}

export function createBot() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('clientReady', (client) => {
    console.log(`Ingelogd als ${client.user.tag}`);
    startSignalScheduler(client);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'status') {
      await interaction.deferReply();
      try {
        const [price, m15Candles, m30Candles, h1Candles, d1Candles, w1Candles] = await Promise.all([
          getXauUsdPrice(),
          getRecentRealCandles({ granularity: 'M15', count: 100 }),
          getRecentRealCandles({ granularity: 'M30', count: 100 }),
          getRecentRealCandles({ granularity: 'H1', count: 50 }),
          getRecentXauD1Candles({ count: 30 }),
          getRecentXauW1Candles({ count: 20 }),
        ]);

        const conditions = checkConditions({ h1Candles, m30Candles, m15Candles, d1Candles, w1Candles });
        const { details, triggered, direction, blockers } = conditions;

        const now = new Date();
        const activeDay = isActiveDay(now);
        const dagNamen = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];
        const dagNaam = dagNamen[now.getUTCDay()];
        const sessionIcon = details.session ? '✅' : '❌';
        const dagIcon = activeDay ? '✅' : '❌';
        const tfIcon = details.tfAlignment?.aligned ? '✅' : '❌';
        const trendIcon = details.trendBias?.aligned ? '✅' : '❌';
        const levelIcon = details.nearLevel?.near ? '✅' : '❌';

        const tfLine = details.tfAlignment
          ? `H1 ${details.h1Bias} | M30 ${details.m30Bias ?? '?'} | M15 ${details.m15Bias ?? '?'} → ${details.tfAlignment.aligned ? `aligned (${details.tfAlignment.direction})` : 'niet aligned'}`
          : '?';
        const trendLine = details.trendBias
          ? details.trendBias.aligned ? `${details.trendBias.direction}` : 'conflicterend'
          : '?';
        const levelLine = details.nearLevel?.near
          ? `${details.nearLevel.label} @ ${details.nearLevel.level} (${details.nearLevel.approachDirection})`
          : `buiten bereik`;

        const statusLine = triggered
          ? `\n**SETUP-TRIGGER ACTIEF → ${direction?.toUpperCase()}**`
          : blockers.length > 0
            ? `\nWachten op: ${blockers.join(' | ')}`
            : '\nAlle condities groen';

        const briefing = await getBriefing();
        const briefingLine = briefing
          ? `\n\n**Macro-briefing actief** (geldig t/m ${new Date(briefing.expiresAt).toISOString().slice(0, 10)})\n> ${briefing.text.slice(0, 200)}${briefing.text.length > 200 ? '…' : ''}`
          : `\n\n_Geen macro-briefing actief. Gebruik /briefing om context in te stellen._`;

        await interaction.editReply(
          `**XAU/USD Status — ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC**\n` +
          `Koers: $${price.price}\n\n` +
          `**Conditie-check:**\n` +
          `${dagIcon} Dag (${dagNaam}): ${activeDay ? 'actief' : 'maandag geblokkeerd (WR 40.9%)'}\n` +
          `${sessionIcon} Sessie (13:00–17:00 UTC): ${details.session ? 'actief' : 'inactief'}\n` +
          `${tfIcon} TF-alignment: ${tfLine}\n` +
          `${trendIcon} D1/W1 trend: ${trendLine}\n` +
          `${levelIcon} Sleutelniveau: ${levelLine}\n` +
          `${statusLine}` +
          briefingLine
        );
      } catch (err) {
        await interaction.editReply(`Status ophalen mislukt: ${err.message}`);
      }
      return;
    }

    if (interaction.commandName === 'analyse') {
      await interaction.deferReply();
      try {
        const newsContext = interaction.options.getString('context') ?? '';
        const candles = await getRecentRealCandles({ granularity: 'H1', count: 50 });
        const dollarCandles = await getRecentEurUsdCandles({ granularity: 'H1', count: 50 });
        const yieldCandles = await getRecentUsYieldCandles({ count: 25 });
        const d1Candles = await getRecentXauD1Candles({ count: 30 });
        const w1Candles = await getRecentXauW1Candles({ count: 20 });
        const newsItems = await fetchGoldNews({ maxItems: 12 });
        const result = await runBoardroom(candles, { newsContext, dollarCandles, yieldCandles, d1Candles, w1Candles, newsItems });
        await reportToDiscord(interaction.client, result);

        const { decision, comboSignal } = result;
        await interaction.editReply(
          truncateForDiscord(
            `**CEO-besluit: ${decision.signal.toUpperCase()}** (zekerheid: ${decision.confidence}%) - ${formatSetupMarker(decision.signal, comboSignal)}\n${decision.reasoning}\n\n` +
              `SL: ${decision.stopLoss} | TP: ${decision.takeProfit} | Positiegrootte: ${decision.positionSize}\n\n` +
              `_Volledige teamdiscussie: zie het #trace-kanaal._`,
          ),
        );
      } catch (err) {
        await interaction.editReply(`Analyse mislukt: ${err.message}`);
      }
      return;
    }

    if (interaction.commandName === 'geschiedenis') {
      await interaction.deferReply();
      try {
        const aantal = interaction.options.getInteger('aantal') ?? 5;
        const signals = await getRecentSignals(aantal);
        if (signals.length === 0) {
          await interaction.editReply('Nog geen signalen gelogd.');
          return;
        }
        const lines = signals.map(
          (s) =>
            `${s.timestamp} - **${s.decision.signal.toUpperCase()}** (${s.decision.confidence}%) - ` +
            `SL ${s.decision.stopLoss} / TP ${s.decision.takeProfit} (${s.decision.positionSize}) - ${formatOutcome(s.outcome)}`,
        );
        await interaction.editReply(lines.join('\n'));
      } catch (err) {
        await interaction.editReply(`Kon geschiedenis niet ophalen: ${err.message}`);
      }
      return;
    }

    if (interaction.commandName === 'briefing') {
      await interaction.deferReply();
      try {
        const wissen = interaction.options.getBoolean('wissen');
        const tekst = interaction.options.getString('tekst');

        if (wissen) {
          await clearBriefing();
          await interaction.editReply('Macro-briefing gewist. Agents ontvangen geen extra context meer.');
          return;
        }

        if (tekst) {
          const briefing = await setBriefing(tekst, interaction.user.username);
          const expires = new Date(briefing.expiresAt).toISOString().slice(0, 10);
          await interaction.editReply(
            truncateForDiscord(
              `**Macro-briefing opgeslagen** (geldig t/m ${expires})\n\n> ${briefing.text}\n\n` +
              `Alle agents ontvangen deze context bij elke volgende boardroom-sessie.`,
            ),
          );
          return;
        }

        // Geen tekst, geen wissen → toon huidige briefing
        const briefing = await getBriefing();
        if (!briefing) {
          await interaction.editReply('Geen actieve macro-briefing. Gebruik `/briefing tekst:...` om er een in te stellen.');
          return;
        }
        const expires = new Date(briefing.expiresAt).toISOString().slice(0, 10);
        const setAt = new Date(briefing.setAt).toISOString().replace('T', ' ').slice(0, 16);
        await interaction.editReply(
          truncateForDiscord(
            `**Actieve macro-briefing** (ingesteld ${setAt} UTC door ${briefing.setBy}, geldig t/m ${expires})\n\n> ${briefing.text}`,
          ),
        );
      } catch (err) {
        await interaction.editReply(`Briefing-actie mislukt: ${err.message}`);
      }
      return;
    }

    if (interaction.commandName === 'health') {
      await interaction.deferReply();
      try {
        const all = await getAllSignals();
        const recente = all.slice(-20);
        const health = summarizeSignalHealth(recente);

        const scoreLines = Object.entries(health.scoreDist)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `  ${k === 'ontbreekt' ? 'ontbreekt' : `${k}/6`}: ${v}×`)
          .join('\n');

        const filterDist = {};
        for (const s of recente) {
          for (const b of (s.qualityResult?.blockers ?? [])) {
            filterDist[b] = (filterDist[b] ?? 0) + 1;
          }
        }
        const filterLines = Object.entries(filterDist).length > 0
          ? Object.entries(filterDist)
              .sort(([, a], [, b]) => b - a)
              .map(([k, v]) => `  • ${k}: ${v}×`)
              .join('\n')
          : '  geen blockers geregistreerd';

        const passed = recente.filter(s => s.qualityResult?.passed === true && s.decision?.signal !== 'neutral').length;
        const blocked = recente.filter(s => s.qualityResult?.passed === false).length;
        const neutraal = recente.filter(s => s.decision?.signal === 'neutral').length;

        const overallStatus = health.invalid === 0
          ? `✅ Alle ${health.n} signalen structureel valide`
          : `🚨 ${health.invalid}/${health.n} signalen hebben structuurfouten`;

        const issueBlock = health.issues.length > 0
          ? `\n\n**Gevonden problemen:**\n${health.issues.map(i => `• ${i}`).join('\n')}`
          : '';

        await interaction.editReply(
          truncateForDiscord(
            `**🏥 Systeem-gezondheidscheck** (laatste ${health.n} signalen)\n\n` +
            `${overallStatus}\n\n` +
            `**Signaalverdeling:**\n` +
            `  🚨 Setup (passed): ${passed} | 🔶 Geblokkeerd: ${blocked} | 💤 Neutraal: ${neutraal}\n\n` +
            `**Setup-kwaliteitsscore verdeling:**\n${scoreLines || '  geen data'}\n\n` +
            `**Meest actieve kwaliteitsfilters:**\n${filterLines}` +
            issueBlock,
          ),
        );
      } catch (err) {
        await interaction.editReply(`Health check mislukt: ${err.message}`);
      }
      return;
    }

    if (interaction.commandName === 'diagnose') {
      await interaction.deferReply();
      try {
        const datumParam = interaction.options.getString('datum');
        const uurParam = interaction.options.getInteger('uur');
        const entries = await getConditionLog();

        if (datumParam) {
          const dateStr = resolveDatum(datumParam);
          if (!dateStr) {
            await interaction.editReply('Ongeldig datumformaat. Gebruik YYYY-MM-DD, "vandaag" of "gisteren".');
            return;
          }
          const dayEntries = filterConditionLog(entries, {
            from: `${dateStr}T00:00:00.000Z`,
            to: `${dateStr}T23:59:59.999Z`,
          });

          if (uurParam !== null && uurParam !== undefined) {
            const hStr = String(uurParam).padStart(2, '0');
            const hourEntries = filterConditionLog(dayEntries, {
              from: `${dateStr}T${hStr}:00:00.000Z`,
              to: `${dateStr}T${hStr}:59:59.999Z`,
            });
            await interaction.editReply(truncateForDiscord(formatHourReport(hourEntries, dateStr, uurParam)));
          } else {
            await interaction.editReply(truncateForDiscord(formatDayReport(dayEntries, dateStr)));
          }
        } else {
          const summary = summarizeConditionLog(entries);
          await interaction.editReply(truncateForDiscord(formatDiagnosticsReport(summary)));
        }
      } catch (err) {
        await interaction.editReply(`Diagnose mislukt: ${err.message}`);
      }
      return;
    }

    if (interaction.commandName === 'ftmo') {
      await interaction.deferReply();
      try {
        const check = await checkFtmoLimits();
        await interaction.editReply(truncateForDiscord(formatFtmoStatus(check)));
      } catch (err) {
        await interaction.editReply(`FTMO-check mislukt: ${err.message}`);
      }
      return;
    }

    if (interaction.commandName === 'performance') {
      await interaction.deferReply();
      try {
        await evaluateOpenSignals(interaction.client);
        const all = await getAllSignals();
        const withOutcome = all.filter((s) => s.outcome);
        const resolved = withOutcome.filter((s) => ['tp', 'sl', 'geen'].includes(s.outcome.result));
        const openCount = all.length - withOutcome.length + withOutcome.filter((s) => s.outcome.result === 'open').length;
        const neutraalCount = withOutcome.filter((s) => s.outcome.result === 'neutraal').length;
        const onbruikbaarCount = withOutcome.filter((s) => s.outcome.result === 'onbruikbaar').length;

        if (resolved.length === 0) {
          await interaction.editReply(
            `Nog geen afgeronde trades.\nOpen: ${openCount} | Neutraal: ${neutraalCount} | Niet evalueerbaar: ${onbruikbaarCount}`,
          );
          return;
        }

        const stats = summarize(resolved);
        const BACKTEST_WR = 53.4; // combo-filter, 87 triggers, Fase 51
        const BACKTEST_N_MIN = 15; // minimaal N voor betrouwbare vergelijking
        const wr = stats.winRate ?? 0;
        const vrTarget = stats.trades >= BACKTEST_N_MIN
          ? (wr >= BACKTEST_WR ? `✅ boven backtest-target (${BACKTEST_WR}%)` : `⚠️ onder backtest-target (${BACKTEST_WR}%)`)
          : `📊 te weinig data voor vergelijking (min. ${BACKTEST_N_MIN})`;

        const recentResolved = resolved.slice(-5);
        const recentStats = summarize(recentResolved);
        const recentLine = recentResolved.length > 0
          ? `Laatste ${recentResolved.length} trades: WR ${recentStats.winRate ?? '-'}% (TP: ${recentStats.tp} / SL: ${recentStats.sl})`
          : '';

        await interaction.editReply(
          `**Performance-overzicht**\n` +
            `Afgeronde trades: ${stats.trades} (TP: ${stats.tp} / SL: ${stats.sl} / geen: ${stats.geen}) → WR ${stats.winRate ?? '-'}%\n` +
            `${vrTarget}\n` +
            `${recentLine ? recentLine + '\n' : ''}` +
            `Gem. zekerheid TP: ${stats.avgConfidenceTp ?? '-'}% | SL: ${stats.avgConfidenceSl ?? '-'}%\n` +
            `Open: ${openCount} | Neutraal: ${neutraalCount} | Niet evalueerbaar: ${onbruikbaarCount}`,
        );
      } catch (err) {
        await interaction.editReply(`Performance-overzicht mislukt: ${err.message}`);
      }
      return;
    }
  });

  return client;
}
