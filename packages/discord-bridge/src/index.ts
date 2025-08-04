import "./httpProxy.js";
import "dotenv/config";
import { startWorker } from "./roomy.js";
import { ClassicLevel } from "classic-level";
import { AutoRouter, cors, error, json } from "itty-router";
import { createServerAdapter } from "@whatwg-node/server";
import { createServer } from "http";
import {
  ApplicationCommandOptionTypes,
  createBot,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
  Intents,
  InteractionTypes,
  MessageFlags,
} from "@discordeno/bot";
import { co, hasFullWritePermissions, RoomyEntity } from "@roomy-chat/sdk";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN)
  throw new Error("DISCORD_TOKEN environment variable not provided.");

const db = new ClassicLevel(process.env.DATA_DIR || "./data", {
  keyEncoding: "utf8",
  valueEncoding: "json",
});

type BidirectionalSublevelMap<A extends string, B extends string> = {
  register: (entry: { [K in A | B]: string }) => Promise<void>;
  unregister: (entry: { [K in A | B]: string }) => Promise<void>;
  sublevel: any;
} & {
  [K in `get_${A}`]: (b: string) => Promise<string | undefined>;
} & {
  [K in `get_${B}`]: (a: string) => Promise<string | undefined>;
};

function createBidirectionalSublevelMap<A extends string, B extends string>(
  sublevelName: string,
  aname: A,
  bname: B,
): BidirectionalSublevelMap<A, B> {
  return {
    /**
     * Sublevel that contains bidirectional mappings from Roomy space to Discord guild ID and
     * vise-versa.
     * */
    sublevel: db.sublevel<string, string>(sublevelName, {
      keyEncoding: "utf8",
      valueEncoding: "utf8",
    }),
    async [`get_${aname}`](b: string): Promise<string | undefined> {
      return await this.sublevel.get(bname + "_" + b);
    },
    async [`get_${bname}`](a: string): Promise<string | undefined> {
      return await this.sublevel.get(aname + "_" + a);
    },
    async unregister(entry: { [K in A | B]: string }) {
      const registeredA: string | undefined = await (
        this[`get_${aname}`] as any
      )(entry[bname]);
      const registeredB: string | undefined = await (
        this[`get_${bname}`] as any
      )(entry[aname]);
      if (registeredA != entry[aname] || registeredB != entry[bname]) {
        throw Error(
          `Cannot deregister ${aname}/${bname}: the provided pair isn't registered.`,
        );
      }
      await this.sublevel.batch([
        {
          type: "del",
          key: aname + "_" + entry[aname],
        },
        {
          type: "del",
          key: bname + "_" + entry[bname],
        },
      ]);
    },
    async register(entry: { [K in A | B]: string }) {
      // Make sure we haven't already registered a bridge for this guild or space.
      if (
        (await this.sublevel.has(aname + "_" + entry[aname])) ||
        (await this.sublevel.has(bname + "_" + entry[bname]))
      ) {
        throw new Error(`${aname} or ${bname} already registered.`);
      }

      this.sublevel.batch([
        {
          key: aname + "_" + entry[aname],
          type: "put",
          value: entry[bname],
        },
        {
          key: bname + "_" + entry[bname],
          type: "put",
          value: entry[aname],
        },
      ]);
    },
  } as any;
}

const registeredBridges = createBidirectionalSublevelMap(
  "registered_bridges",
  "guildId",
  "spaceId",
);
const syncedMessages = createBidirectionalSublevelMap(
  "synced_messages",
  "discordId",
  "roomyId",
);
let discordAppId: string | undefined;

const { worker: jazz } = await startWorker();

// Create the API router
const { preflight, corsify } = cors();
const router = AutoRouter({
  before: [preflight],
  finally: [corsify],
});

router.get("/info", () => {
  if (discordAppId)
    return json({
      discordAppId,
      jazzAccountId: jazz.id,
    });
  return error(500, "Discord bot still starting");
});
router.get("/get-guild-id", async ({ query }) => {
  const spaceId = query.spaceId;
  if (typeof spaceId !== "string")
    return error(400, "spaceId query parameter required");
  const guildId = await registeredBridges.get_guildId(spaceId);
  if (guildId) return json({ guildId });
  return error(404, "Guild not found for provided space");
});
router.get("/get-space-id", async ({ query }) => {
  const guildId = query.guildId;
  if (typeof guildId !== "string")
    return error(400, "guildId query parameter required");
  const spaceId = await registeredBridges.get_spaceId(guildId);
  if (spaceId) return json({ spaceId });
  return error(404, "Space not found for provided guild");
});

// Graceful shutdown
function shutdown() {
  console.log("Shutting down Discord Bridge server...");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start the API server
const PORT = process.env.PORT || 3301;
console.log(`Starting Discord bridge server on 0.0.0.0:${PORT}`);
const ittyServer = createServerAdapter(router.fetch);
const httpServer = createServer(ittyServer);
httpServer.listen(process.env.PORT ? parseInt(process.env.PORT) : 3001);

const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.MessageContent | Intents.Guilds | Intents.GuildMessages,
  desiredProperties: {
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
  },
  events: {
    ready(ready) {
      discordAppId = ready.applicationId.toString();
      console.log("Discord bot ready", ready);

      bot.helpers.upsertGlobalApplicationCommands([
        {
          name: "connect-roomy-space",
          description:
            "Connect a Roomy space to this Discord guild with a 2-way bridge.",
          contexts: [DiscordInteractionContextType.Guild],
          integrationTypes: [DiscordApplicationIntegrationType.GuildInstall],
          defaultMemberPermissions: ["ADMINISTRATOR"],
          options: [
            {
              name: "space-id",
              description: "The ID of the Roomy space to connect to.",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
          ],
        },
        {
          name: "disconnect-roomy-space",
          description:
            "Disconnect the bridged Roomy space if one is connected.",
          contexts: [DiscordInteractionContextType.Guild],
          integrationTypes: [DiscordApplicationIntegrationType.GuildInstall],
          defaultMemberPermissions: ["ADMINISTRATOR"],
        },
        {
          name: "roomy-status",
          description: "Get the current status of the Roomy Discord bridge.",
          contexts: [DiscordInteractionContextType.Guild],
          integrationTypes: [DiscordApplicationIntegrationType.GuildInstall],
          defaultMemberPermissions: ["ADMINISTRATOR"],
        },
      ]);
    },
    async interactionCreate(interaction) {
      const guildId = interaction.guildId;
      if (!guildId) {
        console.error("Guild ID missing from interaction:", interaction);
        interaction.respond({
          flags: MessageFlags.Ephemeral,
          content: "🛑 There was an error connecting your space. 😕",
        });
        return;
      }

      if (interaction.type == InteractionTypes.ApplicationCommand) {
        if (interaction.data?.name == "roomy-status") {
          const spaceId = await registeredBridges.get_spaceId(
            guildId.toString(),
          );
          interaction.respond({
            flags: MessageFlags.Ephemeral,
            content: spaceId
              ? `✅ This Discord server is actively bridged to a Roomy [space](https://roomy.space/${spaceId}).`
              : "🔌 The Discord bridge is not connected to a Roomy space.",
          });
        } else if (interaction.data?.name == "connect-roomy-space") {
          const spaceId = interaction.data.options?.find(
            (x) => x.name == "space-id",
          )?.value as string;

          let space: co.loaded<typeof RoomyEntity> | null = null;
          space = await RoomyEntity.load(spaceId, {
            resolve: {
              components: {
                $each: true,
              },
            },
          });

          if (!space) {
            interaction.respond({
              flags: MessageFlags.Ephemeral,
              content: "🛑 Could not find a space with that ID. 😕",
            });
            return;
          }

          const hasPermissions = await hasFullWritePermissions(jazz, space);
          if (!hasPermissions) {
            interaction.respond({
              flags: MessageFlags.Ephemeral,
              content:
                "🛑 The Discord bot is missing permissions to your Roomy space. " +
                "Don't worry that's easy to fix!\n\nClick \"Grant Access\" in the Discord bridge " +
                "settings page for your space in Roomy, then come back and try to connect again.",
            });
            return;
          }

          const existingRegistration = await registeredBridges.get_spaceId(
            guildId.toString(),
          );
          if (existingRegistration) {
            interaction.respond({
              flags: MessageFlags.Ephemeral,
              content:
                `🛑 This Discord server is already bridge to another Roomy [space](https://roomy.space/${existingRegistration}).` +
                " If you want to connect to a new space, first disconnect it using the `/disconnect-roomy-space` command.",
            });
            return;
          }

          await registeredBridges.register({
            guildId: guildId.toString(),
            spaceId,
          });

          interaction.respond({
            flags: MessageFlags.Ephemeral,
            content: "Roomy space has been connected! 🥳",
          });
        } else if (interaction.data?.name == "disconnect-roomy-space") {
          const roomySpace = await registeredBridges.get_spaceId(
            guildId.toString(),
          );
          if (roomySpace) {
            registeredBridges.unregister({
              guildId: guildId.toString(),
              spaceId: roomySpace,
            });
            interaction.respond({
              flags: MessageFlags.Ephemeral,
              content: "Successfully disconnected the Roomy space. 🔌",
            });
          } else {
            interaction.respond({
              flags: MessageFlags.Ephemeral,
              content:
                "There is no roomy space connected, so I didn't need to do anything. 🤷‍♀️",
            });
          }
        }
      }
    },
  },
});

console.log("Connecting to Discord...");
await bot.start();
