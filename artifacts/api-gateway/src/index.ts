import { createGatewayServer } from "./gateway.js";

function resolvePort(value: string | undefined): number {
  const port = Number(value ?? "8080");

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

const port = resolvePort(process.env.PORT);
const server = createGatewayServer();

server.listen(port, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "gateway.listening", port }));
});

function shutdown(signal: string): void {
  console.info(JSON.stringify({ event: "gateway.shutdown", signal }));
  server.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
