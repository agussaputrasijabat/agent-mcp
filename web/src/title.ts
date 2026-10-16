import { useEffect } from "react";

export function usePageTitle(page: string) {
  useEffect(() => {
    document.title = page === "Agent MCP" ? page : `${page} - Agent MCP`;
  }, [page]);
}

export function titleForPath(path: string): string {
  if (path === "/login") return "Masuk";
  if (path === "/") return "Feed";
  if (path === "/sessions" || path.startsWith("/sessions/")) return "Sesi";
  if (path === "/keys") return "Kunci";
  if (path === "/clients") return "Klien";
  if (path === "/memories") return "Memori";
  if (path === "/settings") return "Pengaturan";
  if (path === "/computer") return "Computer Use";
  if (path === "/docs") return "Dokumentasi";
  if (path === "/setup") return "Setup";
  if (path === "/skills" || path === "/skills/new") return "Skill";
  if (path.startsWith("/skills/")) {
    const name = decodeURIComponent(path.slice("/skills/".length));
    return name || "Skill";
  }
  return "Halaman tidak ditemukan";
}
