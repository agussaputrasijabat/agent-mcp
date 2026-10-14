import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { APIError } from "better-auth/api";
import { betterAuth, type Auth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { jwt } from "better-auth/plugins";
import type { Database } from "bun:sqlite";

export type OperatorAuth = Auth;

const hour = 60 * 60;
const day = 24 * hour;

let allowOperatorCreate = false;

export function mcpResourceUrl(baseURL: string): string {
  return `${baseURL.replace(/\/$/, "")}/mcp`;
}

export async function createOperatorAuth(db: Database, options: { secret: string; baseURL: string }): Promise<OperatorAuth> {
  const config = {
    database: db,
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [options.baseURL],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!allowOperatorCreate) throw new APIError("FORBIDDEN", { message: "Signup is disabled" });
          },
        },
      },
    },
    plugins: [
      jwt(),
      mcp({
        loginPage: "/login",
        consentPage: "/consent",
        resource: mcpResourceUrl(options.baseURL),
        scopes: ["openid", "profile", "email", "offline_access", "mcp"],
        accessTokenExpiresIn: hour,
        refreshTokenExpiresIn: 30 * day,
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
  };
  await (await getMigrations(config)).runMigrations();
  const auth = betterAuth(config);
  const ctx = await auth.$context;
  if (ctx.checkSchema) await ctx.checkSchema();
  return auth;
}

export async function seedOperator(auth: OperatorAuth, db: Database, email: string, password: string): Promise<void> {
  const existing = db.query("SELECT id FROM user WHERE email = ?").get(email) as { id: string } | null;
  if (existing) return;
  allowOperatorCreate = true;
  try {
    await auth.api.signUpEmail({
      body: { email, password, name: "Operator" },
    });
  } finally {
    allowOperatorCreate = false;
  }
}

export async function replaceOperatorPassword(db: Database, password: string): Promise<void> {
  const { hashPassword } = await import("better-auth/crypto");
  const hash = await hashPassword(password);
  const result = db.query("UPDATE account SET password = ? WHERE providerId = 'credential'").run(hash);
  if (result.changes === 0) throw new Error("operator_missing");
}
