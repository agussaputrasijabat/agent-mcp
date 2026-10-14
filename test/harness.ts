import type { Database } from "bun:sqlite";
import { createApp, type AppOptions } from "../src/app.ts";

export const testSecret = "test-secret-test-secret-test-secret";
export const testOperator = { email: "operator@example.com", password: "passwordpassword" };

export function testApp(db: Database, options: AppOptions = {}) {
  return createApp(db, {
    secret: testSecret,
    operator: testOperator,
    baseURL: "http://127.0.0.1:3000",
    ...options,
  });
}
