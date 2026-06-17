import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config/index.js';
import {
  getXauUsdPrice,
  getRecentRealCandles,
  getRecentEurUsdCandles,
  getRecentUsYieldCandles,
  getRecentXauD1Candles,
} from '../services/marketData.js';
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
        const price = await getXauUsdPrice();
        await interaction.editReply(`Systeem actief.\nXAU/USD: ${price.price}\n(${price.time})`);
      } catch (err) {
        await interaction.editReply(`Kon koers niet ophalen: ${err.message}`);
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
