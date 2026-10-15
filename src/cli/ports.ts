import { createServer } from "node:net";

export const DEFAULT_CLI_PORT = 47831;

async function probePort(port: number): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(undefined);
      else reject(error);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      const address = server.address();
      const selected = address && typeof address !== "string" ? address.port : undefined;
      server.close(() => resolve(selected));
    });
  });
}

export async function isPortAvailable(port: number): Promise<boolean> {
  return (await probePort(port)) === port;
}

export async function selectFirstRunPort(preferred = DEFAULT_CLI_PORT): Promise<number> {
  if (await isPortAvailable(preferred)) return preferred;
  const fallback = await probePort(0);
  if (!fallback) throw new Error("no_available_port");
  return fallback;
}
