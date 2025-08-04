import {
  createBot,
  Intents,
  RecursivePartial,
  TransformersDesiredProperties,
} from "@discordeno/bot";
import { DISCORD_TOKEN } from "./env";
import { handleSlashCommandInteraction, slashCommands } from "./slashCommands";

export const botState = {
  appId: undefined as undefined | string,
};

export const desiredProperties = {
  message: {
    id: true,
    guildId: true,
    content: true,
    channelId: true,
    author: true,
  },
  guild: {
    id: true,
    channels: true,
  },
  channel: {
    id: true,
    lastMessageId: true,
    name: true,
    type: true,
  },
  user: {
    username: true,
  },
  interaction: {
    id: true,
    type: true,
    data: true,
    token: true,
    guildId: true,
    authorizingIntegrationOwners: true,
  },
} satisfies RecursivePartial<TransformersDesiredProperties>;

export const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.MessageContent | Intents.Guilds | Intents.GuildMessages,
  desiredProperties,
  events: {
    ready(ready) {
      console.log("Discord bot connected", ready);

      // Set Discord app ID used in `/info` API endpoint.
      botState.appId = ready.applicationId.toString();

      // Update discord slash commands.
      bot.helpers.upsertGlobalApplicationCommands(slashCommands);
    },

    // Handle slash commands
    async interactionCreate(interaction) {
      await handleSlashCommandInteraction(interaction);
    },
  },
});

export async function startBot() {
  await bot.start();
}
