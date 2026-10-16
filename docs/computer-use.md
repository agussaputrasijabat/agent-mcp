# Computer Use: Cua Driver and Cua CLI

Agent MCP can bridge two **optional** MCP runtimes on the operator's machine:

- **Cua Driver** (`cua-driver mcp`) for the existing desktop session.
- **Cua CLI** (`cua mcp`) for local Linux container sandboxes.

This feature is **off by default**. It does not download binaries, start a desktop daemon, change operating-system permissions or authorize a cloud sandbox.

## Install and check

Follow the upstream instructions:

- [Cua Driver installation](https://cua.ai/docs/cua-driver/guides/install)
- [Cua Driver permissions](https://cua.ai/docs/cua-driver/guides/permissions)
- [Cua CLI](https://cua.ai/docs/cua-cli)

After installing:

```sh
cua-driver --version
cua-driver doctor --json
cua-driver permissions status
cua --version
agent-mcp computer doctor
```

The adapter requires **Cua Driver 0.28 or newer**. Older driver versions, including 0.17.0, are explicitly rejected. The diagnostic only checks installed binaries and version compatibility. An installed Cua Driver is **not** proof that its daemon is running or has Accessibility / Screen Recording permission.

The integration launches `cua-driver mcp --direct` with its **own bounded runtime** on every OS. On macOS this uses the CLI process for TCC attribution, not CuaDriver.app's existing daemon. Grant Accessibility and Screen Recording to that process when prompted by the OS; otherwise desktop use will fail closed.

Configure the **Agent MCP server process environment** (not a remotely submitted tool argument):

```sh
CUA_DRIVER_PERMISSION_MODE=bounded
CUA_DRIVER_CAPABILITY_MANIFEST_FILE=/absolute/path/to/reviewed.yaml
CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED=1
CUA_DRIVER_ALLOWED_APPS=com.example.Editor
```

The manifest must be a regular file owned by the server user, not writable by other accounts; version 3 with `expires_after` and `idle_timeout`, an exact `resources.apps` list equal to the configured allowlist, and `resources.desktop.display: false`. It must not grant files, browser resources, arbitrary scripts, or tools outside the adapter's allowlist. Example resource policy: [Cua bounded mode](https://cua.ai/docs/cua-driver/guides/permissions).

**Note:** An unrelated daemon configured in `standard` mode is not considered a trusted authorization boundary by this integration; it is never reused.

## Enable from the dashboard

Open `/computer`, then enable:

- **Host observation**: permits app/window discovery and accessibility snapshots.
- **Host control**: adds mouse/keyboard operations scoped to an exact window. Requires observation.
- **Sandbox observation**: permits discovering local sandboxes and reading state of sandboxes created through this connector.
- **Sandbox management**: permits creating, controlling, stopping, and deleting local Linux container sandboxes owned by the authenticated MCP client. Requires observation.

The server exposes `computer_status`, `computer_driver` and `computer_sandbox` as MCP tools. Each accepts an allowlisted action, while the latter two accept an `parameters` JSON object matching the upstream Cua tool. Tool discovery is checked against the actual installed Cua version, and unavailable actions return an error instead of silently falling back.

Example after granting observation:

```json
{"name":"computer_driver","arguments":{"action":"list_windows","parameters":{"pid":123}}}
```

Use the returned `pid` and `window_id`:

```json
{"name":"computer_driver","arguments":{"action":"get_window_state","parameters":{"pid":123,"window_id":456,"include_screenshot":false}}}
```

For control, pass `target: {"kind":"window","pid":123,"window_id":456}` and a supported action such as `click` or `type_text`. Desktop-wide input, foreground escalation, clipboard, arbitrary scripts and shell access through these tools are deliberately excluded.

Example local sandbox creation (only after management is granted):

```json
{"name":"computer_sandbox","arguments":{"action":"sandbox_create","parameters":{"name":"demo"}}}
```

Sandbox creation is **disabled unless the operator has configured resource limits outside Agent MCP** (CPU, RAM and disk quotas enforced by the local container runtime), then explicitly sets `CUA_SANDBOX_RUNTIME_QUOTAS_VERIFIED=1` in the server environment. The upstream MCP create operation does not expose these resource limits. Merely setting that flag without configuring actual runtime quotas is unsafe.

Agent MCP additionally limits creations to **one sandbox per authenticated client** and **two in total**. Reservations are recorded before creation, and a one-hour lease is enforced by a periodic cleanup task that deletes expired managed sandboxes. A failed or timed-out creation can retain a conservative reservation until it is reconciled.

Subsequent management and computer actions require explicit `local:demo` identity. A client cannot control or delete a sandbox owned by a different MCP API key / OAuth principal. This is a server authorization restriction, not a VM isolation guarantee.

## Security and limitations

- Computer use has **real access to the desktop**. Do not expose it to untrusted clients. Upstream Cua has its own permission mode: use `bounded` for remote/unattended automation.
- All computer call parameters and responses are redacted from Agent MCP's persisted audit log. Clients still receive the requested data, so do not request screenshots of private information unless necessary.
- Computer actions are serialized; sessions have a 10-minute idle lifetime and a limit of 8 active connections. Disabling access closes active sessions.
- Sandbox creation is intentionally limited to local Linux containers. It does not mount host directories, create cloud resources, or expose shell and file-transfer tools.
- The UI reports whether binaries are installed, **not** whether the graphical environment, permissions, or runtime are ready. Run an observation smoke test to confirm readiness.
- Tool access is controlled independently from Agent MCP's general-purpose `shell` and `execute_code` tools, which may still have broad OS permissions.
- Cua Driver on macOS, Windows, and Linux depends on the current graphical session; headless servers may not be suitable.

Upstream contracts: [Cua Driver MCP tools](https://cua.ai/docs/cua-driver/reference/mcp-tools) and [Cua CLI MCP tools](https://cua.ai/docs/cua-cli/reference/mcp-tools).
