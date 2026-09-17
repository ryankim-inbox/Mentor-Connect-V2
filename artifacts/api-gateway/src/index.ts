import path from "node:path";
import { pathToFileURL } from "node:url";

import { createGatewayServer, type GatewayServer } from "./gateway.js";
import {
  createReadinessChecker,
  loadReleaseMetadata,
  type ReadinessChecker,
} from "./readiness.js";

function resolvePort(value: string | undefined): number {
  const port = Number(value ?? "8080");

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

export async function shutdownGateway(
  server: GatewayServer,
  readiness: ReadinessChecker,
): Promise<void> {
  readiness.setDraining();
  server.closeWebSockets();
  const httpClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await Promise.all([httpClosed, readiness.close()]);
}

async function main(): Promise<void> {
  const port = resolvePort(process.env.PORT);
  const readiness = createReadinessChecker();
  const server = createGatewayServer({
    checkReadiness: readiness.checkReadiness,
  });
  const releaseMetadata = await loadReleaseMetadata();

  server.listen(port, "0.0.0.0", () => {
    console.info(
      JSON.stringify({
        event: "gateway.listening",
        port,
        releaseSha: releaseMetadata?.releaseSha ?? "unknown",
      }),
    );
  });

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(JSON.stringify({ event: "gateway.shutdown", signal }));
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10_000);
    deadline.unref();

    void shutdownGateway(server, readiness).then(
      () => {
        clearTimeout(deadline);
        process.exit(0);
      },
      () => {
        clearTimeout(deadline);
        server.closeAllConnections();
        process.exit(1);
      },
    );
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
