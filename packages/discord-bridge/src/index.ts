import "./httpProxy.js";
import "dotenv/config";
import { startBot } from "./discordBot.js";
import { startApi } from "./api.js";

// Graceful shutdown
function shutdown() {
  console.log("Shutting down Discord Bridge server...");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Starting HTTP API...");
startApi();

console.log("Connecting to Discord...");
await startBot();
