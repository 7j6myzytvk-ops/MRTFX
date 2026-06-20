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
import { checkConditions, isActiveSession } from '../services/conditionChecker.js';
import { getBriefing, setBriefing, clearBriefing, formatBriefingNote } from '../services/macroBriefing.js';
import { fetchGoldNews } from '../services/newsService.js';
import { runBoardroom } from '../agents/boardroom.js';
import { reportToDiscord, formatSetupMarker } from '../services/boardroomReporter.js';
import { getRecentSignals, getAllSignals } from '../data/store.js';
import { startSignalScheduler } from '../services/scheduler.js';
import { evaluateOpenSignals } from '../services/performanceTracker.js';
import { summarize } from '../agents/outcomeEvaluator.js';

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

        const sessionIcon = details.session ? '✅' : '❌';
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
          `**XAU/USD Status — ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC**\n` +
          `Koers: $${price.price}\n\n` +
          `**Conditie-check:**\n` +
          `${sessionIcon} Sessie (08:00-17:00 UTC): ${details.session ? 'actief' : 'inactief'}\n` +
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
        const newsItems = await fetchGoldNews({ maxItems: 12 });
        const result = await runBoardroom(candles, { newsContext, dollarCandles, yieldCandles, d1Candles, newsItems });
        await reportToDiscord(interaction.client, result);

        const { decision, comboSignal } = result;
        await interaction.editReply(
          `**CEO-besluit: ${decision.signal.toUpperCase()}** (zekerheid: ${decision.confidence}%) - ${formatSetupMarker(decision.signal, comboSignal)}\n${decision.reasoning}\n\n` +
            `SL: ${decision.stopLoss} | TP: ${decision.takeProfit} | Positiegrootte: ${decision.positionSize}\n\n` +
            `_Volledige teamdiscussie: zie het #trace-kanaal._`,
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
            `**Macro-briefing opgeslagen** (geldig t/m ${expires})\n\n> ${briefing.text}\n\n` +
            `Alle agents ontvangen deze context bij elke volgende boardroom-sessie.`
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
          `**Actieve macro-briefing** (ingesteld ${setAt} UTC door ${briefing.setBy}, geldig t/m ${expires})\n\n> ${briefing.text}`
        );
      } catch (err) {
        await interaction.editReply(`Briefing-actie mislukt: ${err.message}`);
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
        await interaction.editReply(
          `**Performance-overzicht**\n` +
            `Afgeronde trades: ${stats.trades} (TP: ${stats.tp} / SL: ${stats.sl} / geen: ${stats.geen}) -> winRate ${stats.winRate}%\n` +
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
