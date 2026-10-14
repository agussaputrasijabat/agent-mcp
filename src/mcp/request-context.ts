import { AsyncLocalStorage } from "node:async_hooks";

export type McpCallContext = {
  request: Request;
  authKind: "api_key" | "oauth";
  authSubject: string;
  credential: string;
};

const storage = new AsyncLocalStorage<McpCallContext>();

export function runMcpRequest<T>(context: McpCallContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentMcpRequest(): McpCallContext | undefined {
  return storage.getStore();
}
