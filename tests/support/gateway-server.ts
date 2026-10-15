import { writeFileSync } from "node:fs";
import { createGatewayServer } from "../../artifacts/api-gateway/src/gateway.ts";

const server = createGatewayServer({
  upstreamOrigin: process.env.TEST_BACKEND_ORIGIN!,
  publicOrigin: "http://127.0.0.1:14200",
  allowLoopbackPublicOrigin: true,
  logger: { info() {} },
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address() as { port: number };
  writeFileSync(process.env.TEST_GATEWAY_ADDRESS_PATH!, `http://127.0.0.1:${address.port}`);
});
process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close();
});
