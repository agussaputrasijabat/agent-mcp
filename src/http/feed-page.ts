import { operatorNav } from "./nav.ts";

export function feedPage(): string {
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>Feed</title>
    <style>
      :root { color-scheme: dark; }
      @font-face { font-family: Geist; src: url("/fonts/Geist-Variable.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
      body { margin: 0; background: #09090b; color: #fafafa; font-family: Geist, ui-sans-serif, system-ui, sans-serif; }
      main { max-width: 960px; margin: 24px auto; background: #18181b; border-radius: 12px; padding: 24px; }
      p { color: #a1a1aa; }
      table { width: 100%; border-collapse: collapse; }
      td, th { height: 40px; text-align: left; padding: 0 8px; }
      .skeleton { height: 40px; background: #27272a; border-radius: 8px; margin: 0 0 8px; }
      button { height: 40px; border: 0; border-radius: 8px; padding: 0 16px; background: #047857; color: #ffffff; }
    </style>
  </head>
  <body>
    <div style="display:flex;min-height:100vh">
    ${operatorNav("/")}
    <div style="flex:1">
    <main>
      <h1>Feed</h1>
      <p id="empty">Belum ada panggilan tool.</p>
      <p id="failed" hidden>Feed gagal dimuat.</p>
      <button id="retry" type="button" hidden>Coba lagi</button>
      <div id="skeleton" hidden>
        <div class="skeleton"></div>
        <div class="skeleton"></div>
        <div class="skeleton"></div>
        <div class="skeleton"></div>
        <div class="skeleton"></div>
        <div class="skeleton"></div>
      </div>
      <div id="rows"></div>
    </main>
    </div>
    </div>
    <script>
      const empty = document.querySelector("#empty");
      const failed = document.querySelector("#failed");
      const retry = document.querySelector("#retry");
      const skeleton = document.querySelector("#skeleton");
      const rows = document.querySelector("#rows");
      function cell(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
      }
      async function load(showSkeleton) {
        if (showSkeleton) {
          empty.hidden = true;
          failed.hidden = true;
          retry.hidden = true;
          skeleton.hidden = false;
          rows.replaceChildren();
        }
        try {
          const response = await fetch("/api/tool-calls?limit=50");
          if (!response.ok) throw new Error("feed");
          const payload = await response.json();
          const items = payload.data.items;
          skeleton.hidden = true;
          if (items.length === 0) {
            empty.hidden = false;
            rows.replaceChildren();
            return;
          }
          empty.hidden = true;
          failed.hidden = true;
          retry.hidden = true;
          const table = document.createElement("table");
          for (const item of items) {
            const row = document.createElement("tr");
            row.innerHTML = "<td>" + cell(item.tool_name) + "</td><td>" + cell(item.started_at) + "</td><td>" + cell(item.session_key) + "</td><td>" + cell(item.is_error ? "error" : "ok") + "</td>";
            table.append(row);
          }
          rows.replaceChildren(table);
        } catch {
          skeleton.hidden = true;
          empty.hidden = true;
          failed.hidden = false;
          retry.hidden = false;
        }
      }
      retry.addEventListener("click", () => load(true));
      load(true);
      setInterval(() => load(false), 1000);
    </script>
  </body>
</html>`;
}
