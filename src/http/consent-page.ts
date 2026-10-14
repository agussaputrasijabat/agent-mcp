function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

export function consentPage(input: { valid: boolean; clientId: string; scope: string }): string {
  const body = input.valid
    ? `<p class="label">Klien</p>
      <p class="value">${escapeHtml(input.clientId)}</p>
      <p class="label">Scope</p>
      <p class="value">${escapeHtml(input.scope)}</p>
      <div class="actions">
        <button id="allow" type="button">Izinkan</button>
        <button id="deny" type="button">Tolak</button>
      </div>
      <p id="error" hidden>Consent gagal dikirim.</p>
      <script>
        const query = location.search.startsWith("?") ? location.search.slice(1) : "";
        async function decide(accept) {
          const error = document.querySelector("#error");
          try {
            const response = await fetch("/api/auth/oauth2/consent", {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({ accept, oauth_query: query }),
            });
            const payload = await response.json().catch(() => null);
            if (response.ok && payload && typeof payload.url === "string") {
              location.href = payload.url;
              return;
            }
          } catch {
            error.hidden = false;
            return;
          }
          error.hidden = false;
        }
        document.querySelector("#allow").addEventListener("click", () => decide(true));
        document.querySelector("#deny").addEventListener("click", () => decide(false));
      </script>`
    : `<p class="value">Permintaan consent tidak valid.</p>`;

  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Consent - Agent MCP</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <style>
      @font-face { font-family: Geist; src: url("/fonts/Geist-Variable.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
      :root { color-scheme: dark; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101113; color: #f4f4f5; font-family: Geist, ui-sans-serif, system-ui, sans-serif; }
      main { width: min(420px, calc(100% - 32px)); background: #1a1c1f; border: 1px solid #ffffff14; border-radius: 16px; padding: 24px; }
      .mark { margin: 0 0 12px; font-size: 14px; font-weight: 500; }
      h1 { margin: 0 0 16px; font-size: 16px; font-weight: 500; }
      .label { margin: 0 0 4px; color: #a1a1aa; font-size: 14px; }
      .value { margin: 0 0 16px; overflow-wrap: anywhere; }
      .actions { display: flex; gap: 8px; }
      button { height: 40px; border-radius: 999px; padding: 0 16px; font: inherit; cursor: pointer; }
      #allow { background: #69d760; color: #10210f; border: 0; }
      #deny { background: transparent; color: #f4f4f5; border: 1px solid #ffffff14; }
      #error { color: #c46a6a; }
    </style>
  </head>
  <body>
    <main>
      <p class="mark">Agent</p>
      <h1>Consent</h1>
      ${body}
    </main>
  </body>
</html>`;
}
