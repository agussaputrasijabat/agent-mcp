import { Database } from "bun:sqlite";
import { expect, spyOn, test } from "bun:test";
import { getMigrations } from "better-auth/db/migration";
import { createOperatorAuth } from "../src/auth/operator.ts";
import { testSecret } from "./harness.ts";

test("auth restarts accept SQLite TEXT arrays and preserve OAuth client data", async () => {
  const db = new Database(":memory:");
  const warnings = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const options = { secret: testSecret, baseURL: "http://127.0.0.1:3000" };
    const auth = await createOperatorAuth(db, options);
    const client = {
      clientId: "migration-test",
      redirectUris: ["https://example.com/callback"],
      postLogoutRedirectUris: ["https://example.com/logout"],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      scopes: ["openid", "mcp"],
      clientCredentialsScopes: ["mcp"],
      contacts: ["operator@example.com"],
    };
    await (await auth.$context).adapter.create({ model: "oauthClient", data: client });
    const schema = db.query("SELECT sql FROM sqlite_master ORDER BY name").all();

    const restarted = await createOperatorAuth(db, options);
    const stored = await (await restarted.$context).adapter.findOne({
      model: "oauthClient",
      where: [{ field: "clientId", value: client.clientId }],
    });

    expect(stored).toMatchObject(client);
    expect(db.query("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(schema);
    expect(warnings.mock.calls).toEqual([]);
  } finally {
    warnings.mockRestore();
    db.close();
  }
});

test("migration checks still warn for an incompatible SQLite array column", async () => {
  const db = new Database(":memory:");
  const warnings: string[] = [];
  try {
    db.exec("CREATE TABLE arrayRecord (id TEXT PRIMARY KEY NOT NULL, tags INTEGER NOT NULL)");
    await getMigrations({
      database: db,
      logger: { log: (level, message) => { if (level === "warn") warnings.push(message); } },
      plugins: [{
        id: "array-migration-test",
        schema: { arrayRecord: { fields: { tags: { type: "string[]", required: true } } } },
      }],
    });
    expect(warnings).toContain(
      "Field tags in table arrayRecord has a different type in the database. Expected string[] but got INTEGER.",
    );
  } finally {
    db.close();
  }
});
