import { openDatabase } from "../src/db/database.ts";
import { createOperatorAuth, replaceOperatorPassword, seedOperator } from "../src/auth/operator.ts";

const password = process.env.DASHBOARD_PASSWORD ?? "";
const email = process.env.DASHBOARD_EMAIL ?? "";
const secret = process.env.BETTER_AUTH_SECRET ?? "";
if (password.length < 12 || !email || secret.length < 32) {
  console.error(JSON.stringify({ level: "error", msg: "operator_env_missing" }));
  process.exit(1);
}

const db = openDatabase(process.env.DATABASE_PATH ?? "./data/agent.sqlite");
const auth = await createOperatorAuth(db, {
  secret,
  baseURL: process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000",
});
await seedOperator(auth, db, email, password);
await replaceOperatorPassword(db, password);
console.log(JSON.stringify({ level: "info", msg: "operator_password_reset" }));
