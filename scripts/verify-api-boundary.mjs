import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = process.cwd();
let checks = 0;
let failures = 0;

function check(condition, message) {
  checks += 1;

  if (condition) {
    return;
  }

  failures += 1;
  console.error("API boundary check failed: " + message);
}

async function readWorkspaceFile(relativePath) {
  return readFile(resolve(workspaceRoot, relativePath), "utf8");
}

function portBlocks(replitConfig) {
  return replitConfig
    .split(/^\[\[ports\]\]\s*$/m)
    .slice(1)
    .map((block) => ({
      localPort: /^\s*localPort\s*=\s*(\d+)\s*$/m.exec(block)?.[1],
      externalPort: /^\s*externalPort\s*=\s*(\d+)\s*$/m.exec(block)?.[1],
      exposeLocalhost: /^\s*exposeLocalhost\s*=\s*(true|false)\s*$/m.exec(block)?.[1],
    }));
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function verifyBundleDoesNotExposePrivateUpstream() {
  const bundleDirectory = resolve(workspaceRoot, "artifacts/peerbridge/dist");
  let files;

  try {
    files = await listFiles(bundleDirectory);
  } catch {
    check(false, "frontend bundle is missing; run pnpm --filter @workspace/peerbridge build first");
    return;
  }

  const forbiddenMarkers = [
    "127.0.0.1:8181",
    "localhost:8181",
    "GATEWAY_UPSTREAM_ORIGIN",
    "localhost:8000",
    "127.0.0.1:8000",
  ];

  for (const file of files) {
    const content = await readFile(file, "utf8");

    for (const marker of forbiddenMarkers) {
      check(
        !content.includes(marker),
        "frontend bundle contains private upstream marker " + marker,
      );
    }
  }
}

const [replitConfig, gatewayArtifact, privateBackendArtifact] = await Promise.all([
  readWorkspaceFile(".replit"),
  readWorkspaceFile("artifacts/api-gateway/.replit-artifact/artifact.toml"),
  readWorkspaceFile("artifacts/api-server/.replit-artifact/artifact.toml"),
]);

const ports = portBlocks(replitConfig);
const publicPorts = ports.filter((port) => port.externalPort !== undefined);

check(
  publicPorts.length === 1 &&
    publicPorts[0]?.localPort === "8080" &&
    publicPorts[0]?.externalPort === "80",
  ".replit must expose only gateway localPort 8080 as externalPort 80",
);

const privatePort = ports.find((port) => port.localPort === "8181");
check(
  privatePort?.externalPort === undefined && privatePort?.exposeLocalhost === "false",
  "private Python port 8181 must have no externalPort and exposeLocalhost = false",
);

check(
  /localPort\s*=\s*8080/.test(gatewayArtifact),
  "gateway artifact must listen on port 8080",
);
check(
  /paths\s*=\s*\[\s*"\/api"\s*,\s*"\/livez"\s*,\s*"\/ws"\s*\]/.test(gatewayArtifact),
  "gateway artifact must own /api, /livez, and /ws",
);
check(
  /GATEWAY_UPSTREAM_ORIGIN\s*=\s*"http:\/\/127\.0\.0\.1:8181"/.test(gatewayArtifact),
  "gateway upstream must be the private loopback address",
);
check(
  /args\s*=\s*\[\s*"node"\s*,\s*"artifacts\/api-gateway\/dist\/index\.js"\s*\]/.test(
    gatewayArtifact,
  ),
  "gateway production service must execute the compiled API Shield",
);

check(
  /localPort\s*=\s*8181/.test(privateBackendArtifact),
  "private Python artifact must listen on port 8181",
);
check(
  /paths\s*=\s*\[\s*\]/.test(privateBackendArtifact),
  "private Python artifact must not own a public path",
);
check(
  /"--host"\s*,\s*"127\.0\.0\.1"/.test(privateBackendArtifact),
  "private Python artifact must bind uvicorn to 127.0.0.1",
);
check(
  !/paths\s*=\s*\[\s*"\/api"/.test(privateBackendArtifact),
  "private Python artifact must not be a public /api route owner",
);

await verifyBundleDoesNotExposePrivateUpstream();

if (failures > 0) {
  console.error("API boundary verification failed (" + failures + " of " + checks + " checks).");
  process.exitCode = 1;
} else {
  console.log("API boundary verification passed (" + checks + " checks).");
}
