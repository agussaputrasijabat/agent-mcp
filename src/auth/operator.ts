import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { Database } from "bun:sqlite";

export type OperatorAuth = ReturnType<typeof betterAuth>;

let allowOperatorCreate = false;

export async function createOperatorAuth(db: Database, options: { secret: string; baseURL: string }): Promise<OperatorAuth> {
  const auth = betterAuth({
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
  });
  await (await getMigrations(auth.options)).runMigrations();
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
