import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FeedPage } from "./feed.tsx";
import { DocsPage, SetupPage } from "./guide.tsx";
import { LoginPage } from "./login.tsx";
import { ComputerPage } from "./computer.tsx";
import { ClientsPage, KeysPage, MemoriesPage, SettingsPage, SkillEditor, SkillsPage } from "./pages.tsx";
import { SessionDetailPage, SessionsPage } from "./sessions.tsx";
import { Shell } from "./shell.tsx";
import { titleForPath, usePageTitle } from "./title.ts";

export function App() {
  const path = window.location.pathname;
  usePageTitle(titleForPath(path));
  if (path === "/login") return <LoginPage />;
  if (path === "/") return <FeedPage />;
  if (path === "/sessions") return <Shell><SessionsPage /></Shell>;
  if (path.startsWith("/sessions/")) {
    return <Shell><SessionDetailPage sessionKey={decodeURIComponent(path.slice("/sessions/".length))} /></Shell>;
  }
  if (path === "/keys") return <Shell><KeysPage /></Shell>;
  if (path === "/clients") return <Shell><ClientsPage /></Shell>;
  if (path === "/settings") return <Shell><SettingsPage /></Shell>;
  if (path === "/computer") return <Shell><ComputerPage /></Shell>;
  if (path === "/memories") return <Shell><MemoriesPage /></Shell>;
  if (path === "/skills") return <Shell><SkillsPage /></Shell>;
  if (path === "/skills/new") return <Shell><SkillEditor /></Shell>;
  if (path.startsWith("/skills/")) {
    return <Shell><SkillEditor name={decodeURIComponent(path.slice("/skills/".length))} /></Shell>;
  }
  if (path === "/docs") return <Shell><DocsPage /></Shell>;
  if (path === "/setup") return <Shell><SetupPage /></Shell>;

  return <Shell>
    <Card className="w-full">
      <CardContent className="flex flex-col items-start gap-4 py-12">
        <p className="font-mono text-sm text-primary">404</p>
        <h2 className="text-2xl font-semibold tracking-tight">Halaman tidak ditemukan</h2>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          Alamat yang kamu buka tidak tersedia di konsol ini. Kembali ke feed untuk melanjutkan.
        </p>
        <Button asChild><a href="/">Kembali ke feed</a></Button>
      </CardContent>
    </Card>
  </Shell>;
}
