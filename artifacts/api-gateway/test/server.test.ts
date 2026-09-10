import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import test from "node:test";

import { createGatewayServer, type GatewayLogger } from "../src/gateway.ts";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Server did not bind a TCP port");
  }

  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function rawRequest(
  port: number,
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers,
        });
      });
    });

    request.once("error", reject);
    request.end();
  });
}

test("quarantines risky route variants before an upstream request", async (context) => {
  const upstreamRequests: Array<{ url: string | undefined }> = [];
  const securityEvents: Array<{
    event: string;
    fields: Readonly<Record<string, boolean | number | string>>;
  }> = [];
  const logger: GatewayLogger = {
    info(event, fields) {
      securityEvents.push({ event, fields });
    },
  };
  const upstream = createServer((request, response) => {
    upstreamRequests.push({
      url: request.url,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  const upstreamPort = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    logger,
  });
  const gatewayPort = await listen(gateway);

  context.after(async () => {
    await Promise.all([close(gateway), close(upstream)]);
  });

  const deniedRequests = await Promise.all([
    rawRequest(gatewayPort, "/api/admin/flagged-users"),
    rawRequest(gatewayPort, "/api/admin%2Fflagged-users", "POST", { Cookie: "session=invalid" }),
    rawRequest(gatewayPort, "/api/admin;version=1/flagged-users", "DELETE"),
    rawRequest(gatewayPort, "/api/python-reports/"),
    rawRequest(gatewayPort, "/api/python%2Dreports/summary", "PATCH"),
    rawRequest(gatewayPort, "/api/matches/blocked-mentor-42"),
    rawRequest(gatewayPort, "/api/matches", "POST"),
    rawRequest(gatewayPort, "/api/practice/matching/1?limit=1000&mentor_id=blocked-mentor-42"),
    rawRequest(gatewayPort, "/api/practice%2Fmatching%2F1", "DELETE"),
    rawRequest(gatewayPort, "/api/requests/1/match", "POST"),
    rawRequest(gatewayPort, "/api/requests%2Fblocked-mentor-42%2Fmatch", "PATCH"),
    rawRequest(gatewayPort, "/api/chat/rooms"),
    rawRequest(gatewayPort, "/api/chat%2Frooms", "POST", { Cookie: "session=authenticated" }),
    rawRequest(gatewayPort, "/api/dms/1"),
    rawRequest(gatewayPort, "/api/dms%2F1", "POST", { Cookie: "session=authenticated" }),
    rawRequest(gatewayPort, "/ws/chat/1"),
    rawRequest(gatewayPort, "/ws%2Fchat%2F1", "POST", { Cookie: "session=authenticated" }),
  ]);

  assert.equal(upstreamRequests.length, 0);
  assert.deepEqual(new Set(deniedRequests.map((result) => result.status)), new Set([404]));
  assert.deepEqual(new Set(deniedRequests.map((result) => result.body)), new Set(['{"error":"not_found"}']));
  assert.deepEqual(
    new Set(deniedRequests.map((result) => result.headers["content-length"])),
    new Set([String(Buffer.byteLength('{"error":"not_found"}'))]),
  );
  const metrics = securityEvents.filter((event) => event.event === "gateway.quarantine_denied");
  assert.equal(metrics.length, deniedRequests.length);

  for (const metric of metrics) {
    assert.deepEqual(Object.keys(metric.fields).sort(), ["correlationId", "outcome", "routeFamily", "status"]);
    assert.equal(metric.fields.outcome, "denied");
    assert.equal(metric.fields.status, 404);
    assert.doesNotMatch(
      JSON.stringify(metric),
      /session=invalid|session=authenticated|flagged-users|summary|blocked-mentor-42|mentor_id/,
    );
  }

  const ordinaryResponse = await rawRequest(gatewayPort, "/api/healthz");

  assert.equal(ordinaryResponse.status, 200);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].url, "/api/healthz");
  assert.equal(typeof ordinaryResponse.headers["x-request-id"], "string");
});
