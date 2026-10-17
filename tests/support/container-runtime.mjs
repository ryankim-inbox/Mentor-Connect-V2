// Disposable integration-test launch settings, never production configuration.
export function containerRuntime({ databaseUrl, port, platform, cpus = "0.1" }) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
      !/^\/chat_test_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error("disposable loopback PostgreSQL required");
  }
  if (!["0.1", "1"].includes(cpus)) throw new Error("test CPU must be 0.1 or 1");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid test port");
  const nativeLinux = platform === "linux";
  if (!nativeLinux) url.hostname = "host.docker.internal";
  return {
    databaseUrl: url.href,
    port: nativeLinux ? port : 10000,
    dockerArgs: ["--memory=512m", "--memory-swap=512m", `--cpus=${cpus}`,
      ...(nativeLinux ? ["--network=host"] : ["-p", "127.0.0.1::10000"])],
  };
}
