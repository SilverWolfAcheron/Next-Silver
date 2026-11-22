const PROXY_FLAG: string = "NODE_USE_ENV_PROXY";
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1"];

function bypassEntries(configured: string | undefined): string[] {
  const entries: string[] = (configured ?? "")
    .split(",")
    .map((entry: string): string => entry.trim())
    .filter((entry: string): boolean => entry.length > 0);
  for (const host of LOOPBACK_HOSTS) {
    if (!entries.some((entry: string): boolean => entry.toLowerCase() === host)) entries.push(host);
  }
  return entries;
}

export function noProxyList(configured: string | undefined): string {
  return bypassEntries(configured).join(",");
}

// Node's fetch ignores HTTP(S)_PROXY unless the process starts with
// NODE_USE_ENV_PROXY, so provider calls from the host would otherwise connect
// directly even when the machine can only reach providers through a proxy.
// Loopback bypass entries stay in place because the host and the CLI always
// talk over 127.0.0.1 and must never be routed through the proxy.
export function runtimeEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...base };
  const configured: string | undefined = base.NO_PROXY ?? base.no_proxy;
  delete environment.no_proxy;
  environment.NO_PROXY = noProxyList(configured);
  environment[PROXY_FLAG] ??= "1";
  return environment;
}
