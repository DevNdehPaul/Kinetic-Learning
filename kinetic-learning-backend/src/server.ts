import "dotenv/config";
import app from "./app.js";
import prisma from "./lib/prisma.js";
import { validateEnvironment } from "./config/env.js";

validateEnvironment();
const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, "0.0.0.0", () => console.log(`Kinetic Learning API running on port ${PORT}`));

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Shutting down gracefully.`);
  server.close(async () => {
    try { await prisma.$disconnect(); }
    finally { process.exit(0); }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
