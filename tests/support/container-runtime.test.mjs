import assert from "node:assert/strict";
import test from "node:test";
import { containerRuntime } from "./container-runtime.mjs";

const databaseUrl = "postgresql://fixture@127.0.0.1:54327/chat_test_fixture";

test("native Linux reaches the disposable loopback database using host networking", () => {
  const config = containerRuntime({ databaseUrl, platform: "linux", port: 32100 });
  assert.equal(config.databaseUrl, databaseUrl);
  assert.equal(config.port, 32100);
  assert.deepEqual(config.dockerArgs, ["--memory=512m", "--memory-swap=512m", "--cpus=0.1", "--network=host"]);
});

test("Docker Desktop retains the existing bridge mapping", () => {
  const config = containerRuntime({ databaseUrl, platform: "darwin", port: 32100 });
  assert.equal(new URL(config.databaseUrl).hostname, "host.docker.internal");
  assert.equal(config.port, 10000);
  assert.deepEqual(config.dockerArgs.slice(-2), ["-p", "127.0.0.1::10000"]);
});

test("the separate one-CPU control changes only its explicit CPU allocation", () => {
  const config = containerRuntime({ databaseUrl, platform: "linux", port: 32100, cpus: "1" });
  assert.ok(config.dockerArgs.includes("--cpus=1"));
  assert.ok(config.dockerArgs.includes("--memory=512m"));
  assert.ok(config.dockerArgs.includes("--memory-swap=512m"));
});

test("rejects unintended resource settings and non-disposable database targets", () => {
  for (const cpus of ["0", "0.5", "2", "--privileged"]) {
    assert.throws(() => containerRuntime({ databaseUrl, platform: "linux", port: 32100, cpus }));
  }
  for (const url of [databaseUrl.replace("127.0.0.1", "example.com"), databaseUrl.replace("chat_test_fixture", "neondb")]) {
    assert.throws(() => containerRuntime({ databaseUrl: url, platform: "linux", port: 32100 }));
  }
  assert.throws(() => containerRuntime({ databaseUrl, platform: "linux", port: 0 }));
});
