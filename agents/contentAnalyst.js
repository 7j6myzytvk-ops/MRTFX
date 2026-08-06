import { makeClient } from './anthropicClient.js';
import { config } from '../config/index.js';

const client = makeClient();

// Analyseert een transcript of tekst en extraheert gestructureerde regime-inzichten
// die relevant zijn voor XAU/USD trading.
export async function extractInsights({ tekst, bron, bronType }) {
  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    tools: [
      {
        name: 'sla_inzichten_op',
        description: 'Sla gestructureerde marktregime-inzichten op uit de geanalyseerde content.',
        input_schema: {
          type: 'object',
          properties: {
            relevant: {
              type: 'boolean',
              description: 'Is deze content relevant voor XAU/USD trading of macro-marktstructuur?',
            },
            inzichten: {
              type: 'array',
              description: 'Lijst van concrete, actionable inzichten. Leeg als niet relevant.',
              items: {
                type: 'object',
                properties: {
                  inzicht: {
                    type: 'string',
                    description: 'Concreet marktregime-inzicht in één zin.',
                  },
                  implicatie: {
                    type: 'string',
                    description: 'Directe implicatie voor XAU/USD trading in één zin.',
                  },
                  markt: {
                    type: 'string',
                    enum: ['XAU/USD', 'algemeen'],
                    description: 'Is dit specifiek voor goud of algemeen van toepassing?',
                  },
                  geldigDagen: {
                    type: 'integer',
                    description: 'Geschatte houdbaarheid van dit inzicht in dagen (7-90).',
                  },
                },
                required: ['inzicht', 'implicatie', 'markt', 'geldigDagen'],
              },
            },
          },
          required: ['relevant', 'inzichten'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'sla_inzichten_op' },
    messages: [
      {
        role: 'user',
        content:
          `Je bent een expert in macro-economie en XAU/USD marktstructuur. ` +
          `Analyseer de volgende content van "${bron}" en extraheer ALLEEN concrete, ` +
          `actionable inzichten die relevant zijn voor het traden van XAU/USD.\n\n` +
          `Focus op:\n` +
          `- Structurele marktregime-verschuivingen (bv. goud reageert niet meer op geopolitiek)\n` +
          `- Correlatie-veranderingen (bv. gold vs dollar, gold vs Bitcoin)\n` +
          `- Institutioneel gedrag (centrale bank aankopen, grote spelers)\n` +
          `- Macro-regime shifts (rente, inflatie, risk-on/off)\n` +
          `- Technische sleutelniveaus of structuurbreuk op hogere timeframes\n\n` +
          `Negeer algemene motivatietips, levensverhalen, en niet-trading content.\n\n` +
          `CONTENT:\n${tekst.substring(0, 8000)}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  return toolUse?.input ?? { relevant: false, inzichten: [] };
}
