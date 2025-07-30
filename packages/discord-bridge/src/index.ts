import "./httpProxy.js";
import "dotenv/config";
import { startWorker } from "./jazz.js";
import { ClassicLevel } from "classic-level";
import { AutoRouter, cors, json } from "itty-router";
import { createServerAdapter } from "@whatwg-node/server";
import { createServer } from "http";
import { createBot, Intents } from "@discordeno/bot";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN)
  throw new Error("DISCORD_TOKEN environment variable not provided.");

const db = new ClassicLevel(process.env.DATA_DIR || "./data", {
  valueEncoding: "json",
});

const { worker: jazz } = await startWorker();

// Create the API router
const { preflight, corsify } = cors();
const router = AutoRouter({
  before: [preflight],
  finally: [corsify],
});

// Health check endpoint
router.get("/health", () => {
  return json({
    status: "ok",
    service: "discord-bridge",
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown
function shutdown() {
  console.log("Shutting down Discord Bridge server...");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start the API server
const PORT = process.env.PORT || 3001;
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
    },
  },
  events: {
    ready(ready) {
      console.log("Discord bot ready", ready);
    },
  },
});

console.log("Connecting to Discord...");
await bot.start();
