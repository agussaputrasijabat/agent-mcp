import { FeedPage } from "./feed.tsx";
import { LoginPage } from "./login.tsx";
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
  let page = <KeysPage />;
  if (path === "/clients") page = <ClientsPage />;
  else if (path === "/settings") page = <SettingsPage />;
  else if (path === "/memories") page = <MemoriesPage />;
  else if (path === "/skills") page = <SkillsPage />;
  else if (path === "/skills/new") page = <SkillEditor />;
  else if (path.startsWith("/skills/")) page = <SkillEditor name={decodeURIComponent(path.slice("/skills/".length))} />;
  return <Shell>{page}</Shell>;
}
