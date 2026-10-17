import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer as httpsServer } from "node:https";
import { request } from "node:http";
import net from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
import { createGatewayServer } from "../../artifacts/api-gateway/dist/gateway.js";
import { createReadinessChecker } from "../../artifacts/api-gateway/dist/readiness.js";
import { bootstrapClassroom } from "../../ops/bootstrap-classroom.mjs";
import { verifySchemaAssets } from "../../lib/db/tools/schema-assets.mjs";
import { runMentorshipJourney } from "./mentorship-journey.mjs";
import { runAccountTrustJourney } from "./account-trust-journey.mjs";
import { runLiveChat } from "../../scripts/smoke-live-chat.mjs";
const { Client } = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
)("pg");
const root = process.cwd(),
  temp = process.env.LIVE_LOCAL_TMP;
const dsn = process.env.LIVE_LOCAL_DATABASE_URL;
if (!dsn || !temp || !dsn.includes("chat_test_"))
  throw new Error("disposable test database required");
const db = new Client({ connectionString: dsn });
await db.connect();
const { ledger } = await verifySchemaAssets({ rootDir: root });
await bootstrapClassroom({ client: db, ledger, appSha: "448e39ff" });
await db.query(readFileSync("tests/fixtures/chat-canonical.sql", "utf8"));
await db.query(readFileSync("tests/fixtures/account-trust-verified.sql", "utf8"));
await db.end();
const key = path.join(temp, "key.pem"),
  cert = path.join(temp, "cert.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
  ],
  { stdio: "ignore" },
);
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
const portFinder = net.createServer();
const backendPort = await listen(portFinder);
await new Promise((resolve) => portFinder.close(resolve));
let python, gateway, checker, browser, containerId, gatewayPort;
const containerImage = process.env.DEPLOYMENT_TEST_IMAGE;
let developmentDelivery = !containerImage;
const ownershipOutbox = path.join(temp, "ownership-outbox");
const sockets = new Set();
const tls = httpsServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (req, res) => {
    const upstream = request(
      {
        host: "127.0.0.1",
        port: gatewayPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (incoming) => {
        res.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  },
);
tls.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
tls.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(gatewayPort, "127.0.0.1", () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        req.rawHeaders.reduce(
          (lines, value, i, headers) =>
            i % 2 ? lines : lines + value + ": " + headers[i + 1] + "\r\n",
          "",
        ) +
        "\r\n",
    );
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
  upstream.on("close", () => socket.destroy());
});
const port = await listen(tls),
  origin = `https://127.0.0.1:${port}`;
async function startPython() {
  python = spawn(
    process.env.CLASSROOM_TEST_PYTHON ||
      process.env.PYTHON_BIN ||
      path.join(root, ".venv/bin/python"),
    [
      "-m",
      "uvicorn",
      "main:app",
      "--app-dir",
      "Python",
      "--host",
      "127.0.0.1",
      "--port",
      String(backendPort),
      "--workers",
      "1",
      "--no-access-log",
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: dsn,
        SESSION_SECRET: "local-test-session-secret-is-long-enough",
        NODE_ENV: developmentDelivery ? "test" : "production",
        EMAIL_DELIVERY_MODE: developmentDelivery ? "development-file" : "disabled",
        EMAIL_DEV_OUTBOX_DIR: ownershipOutbox,
        APP_ORIGIN: origin,
      },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${backendPort}/api/healthz`)).ok)
        return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("local backend did not start");
}
async function stopPython() {
  if (python && python.exitCode === null) {
    python.kill("SIGTERM");
    await once(python, "exit");
  }
}
async function startGateway() {
  checker = createReadinessChecker({
    databaseUrl: dsn,
    upstreamOrigin: `http://127.0.0.1:${backendPort}`,
  });
  gateway = createGatewayServer({
    publicOrigin: origin,
    upstreamOrigin: `http://127.0.0.1:${backendPort}`,
    staticDirectory: path.join(root, "artifacts/peerbridge/dist/public"),
    checkReadiness: checker.checkReadiness,
    logger: { info() {} },
  });
  gatewayPort = await listen(gateway);
}
async function stopGateway() {
  gateway?.closeWebSockets();
  gateway?.closeAllConnections();
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  await checker?.close();
}
async function startStack() {
  if (!containerImage) {
    await startPython();
    await startGateway();
    return;
  }
  const url = new URL(dsn);
  url.hostname = "host.docker.internal";
  const envFile = path.join(temp, "container.env");
  writeFileSync(
    envFile,
    `DATABASE_URL=${url.href}\nREADINESS_DATABASE_URL=${url.href}\nSESSION_SECRET=local-test-session-secret-is-long-enough\nGATEWAY_PUBLIC_ORIGIN=${origin}\n`,
    { mode: 0o600 },
  );
  containerId = execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--memory=512m",
      "--memory-swap=512m",
      "--cpus=0.1",
      "-p",
      "127.0.0.1::10000",
      "--env-file",
      envFile,
      containerImage,
    ],
    { encoding: "utf8" },
  ).trim();
  const inspected = JSON.parse(
    execFileSync("docker", ["inspect", containerId], { encoding: "utf8" }),
  );
  gatewayPort = Number(
    inspected[0].NetworkSettings.Ports["10000/tcp"][0].HostPort,
  );
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${gatewayPort}/readyz`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("container did not become ready");
}
async function stopStack() {
  if (containerId) {
    const stats = execFileSync(
      "docker",
      ["exec", containerId, "cat", "/sys/fs/cgroup/memory.peak"],
      { encoding: "utf8" },
    ).trim();
    const memory = Number(stats);
    console.log(
      JSON.stringify({
        task: "container-memory",
        peakMiB: Math.round((memory / 1024 / 1024) * 10) / 10,
        limitMiB: 512,
      }),
    );
    execFileSync("docker", ["stop", "--time", "15", containerId], {
      stdio: "ignore",
    });
    containerId = undefined;
  } else {
    await stopGateway();
    await stopPython();
  }
}
try {
  await startStack();
  browser = await chromium.launch();
  // Only the disposable local TLS harness bypasses cert trust. CLI keeps normal verification.
  const localBrowser = {
    newContext: (options) =>
      browser.newContext({ ...options, ignoreHTTPSErrors: true }),
  };
  if (developmentDelivery) {
    await runAccountTrustJourney({origin, outbox:ownershipOutbox},localBrowser);
    await stopStack();
    developmentDelivery = false;
    await startStack();
  }
  const config = {
    origin,
    credentials: {
      accounts: {
        mentor: {
          id: 501,
          email: "mentor501@test.edu",
          password: "Password123!",
        },
        mentee: {
          id: 2,
          email: "aiko.yoon.0002@test.edu",
          password: "Password123!",
        },
      },
      fixtures: { globalRoomId: 1, districtIds: [1, 2], outsiderUserId: 951 },
    },
  };
  await runMentorshipJourney(config, localBrowser, async () => { await stopStack(); await startStack(); });
  await runLiveChat(config, localBrowser, {
    restart: async () => {
      await stopStack();
      await startStack();
    },
  });
} finally {
  await browser?.close();
  await stopStack();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => tls.close(resolve));
}
