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
    ? `<p>Klien</p>
      <p>${escapeHtml(input.clientId)}</p>
      <p>Scope</p>
      <p>${escapeHtml(input.scope)}</p>
      <p>
        <button id="allow" type="button">Izinkan</button>
        <button id="deny" type="button">Tolak</button>
      </p>
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
    : `<p>Permintaan consent tidak valid.</p>`;

  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>Consent</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; background: #09090b; color: #fafafa; font-family: ui-sans-serif, system-ui, sans-serif; }
      main { max-width: 420px; margin: 48px auto; background: #18181b; border-radius: 12px; padding: 24px; }
      p { color: #a1a1aa; }
      button { height: 40px; border-radius: 8px; padding: 0 16px; }
      #allow { background: #047857; color: #ffffff; border: 0; }
      #deny { background: transparent; color: #fafafa; border: 1px solid #3f3f46; }
    </style>
  </head>
  <body>
    <main>
      <h1>Consent</h1>
      ${body}
    </main>
  </body>
</html>`;
}
