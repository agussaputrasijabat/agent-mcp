# Better Auth compatibility patches

## SQLite array types

`better-auth@1.7.7.patch` fixes the migration type check for SQLite arrays. Better Auth creates `string[]` and `number[]` fields as JSON strings in `TEXT` columns, but its checker only accepts JSON column types. This patch accepts SQLite `TEXT` while preserving warnings for incompatible types.

Bun applies the patch through `patchedDependencies` during installation. No database migration is needed. Remove it after upgrading to a Better Auth release that fixes this check, and run `bun test test/auth-migration.test.ts` to verify restart behavior and OAuth data preservation.

## CIMD address selection

`@better-auth/cimd@1.7.7.patch` prefers a public IPv4 answer when metadata hosts also return IPv6. The original transport pins the first DNS answer, which fails on hosts without working IPv6 connectivity. IPv6-only metadata hosts remain supported. Every DNS answer is still validated, the chosen address remains pinned, and the original Host, TLS identity, abort signal, and redirect policy are preserved.

Run `bun test test/cimd-transport.test.ts` when upgrading this dependency, and remove the patch once upstream supports the required address selection.

## Discovered client JWKS trust

`@better-auth/oauth-provider@1.7.7.patch` adds an `isTrustedClientJwksUri` policy for verified URL clients. It applies during CIMD registration and `private_key_jwt` verification while preserving HTTPS, public-address, DNS pinning, and redirect checks. It does not change browser `trustedOrigins`.

The application policy in `src/auth/client-jwks.ts` permits only Google's account-linking key URL for metadata under Google's user-bound provider namespace. Google publishes its metadata at `accountlinking.google.com` and its JWT verification keys at `www.gstatic.com`. Other cross-origin key URLs keep the default trust rules. Run `bun test test/cimd-transport.test.ts` when changing this patch or policy.
