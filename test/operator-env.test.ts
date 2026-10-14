import { expect, test } from "bun:test";
import { operatorEnvError } from "../src/app.ts";

const email = "operator@example.com";
const longEnough = "123456789012";

test("missing email or empty password is operator_env_missing", () => {
  expect(operatorEnvError("", "")).toBe("operator_env_missing");
  expect(operatorEnvError("", longEnough)).toBe("operator_env_missing");
  expect(operatorEnvError(email, "")).toBe("operator_env_missing");
});

test("password shorter than 12 is password_too_short", () => {
  expect(operatorEnvError(email, "12345678")).toBe("password_too_short");
  expect(operatorEnvError(email, "12345678901")).toBe("password_too_short");
});

test("email and a 12 character password pass", () => {
  expect(operatorEnvError(email, longEnough)).toBeNull();
  expect(operatorEnvError(email, "1234567890123")).toBeNull();
});
