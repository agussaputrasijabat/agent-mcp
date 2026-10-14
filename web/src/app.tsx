import { ClientsPage, KeysPage, MemoriesPage, SettingsPage, SkillEditor, SkillsPage } from "./pages.tsx";
import { Shell } from "./shell.tsx";

export function App() {
  const path = window.location.pathname;
  let page = <KeysPage />;
  if (path === "/clients") page = <ClientsPage />;
  else if (path === "/settings") page = <SettingsPage />;
  else if (path === "/memories") page = <MemoriesPage />;
  else if (path === "/skills") page = <SkillsPage />;
  else if (path === "/skills/new") page = <SkillEditor />;
  else if (path.startsWith("/skills/")) page = <SkillEditor name={decodeURIComponent(path.slice("/skills/".length))} />;
  return <Shell>{page}</Shell>;
}
