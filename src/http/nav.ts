const items = [
  ["/", "Feed"],
  ["/sessions", "Sesi"],
  ["/keys", "Kunci API"],
  ["/clients", "Klien"],
  ["/memories", "Memori"],
  ["/skills", "Skill"],
  ["/settings", "Pengaturan"],
] as const;

export function operatorNav(active: string): string {
  return `<nav style="width:220px;flex:none;background:#09090b">
    ${items
      .map(([href, label]) => {
        const on = href === active;
        return `<a href="${href}" style="display:flex;align-items:center;height:40px;padding:0 16px;text-decoration:none;color:${on ? "#fafafa" : "#a1a1aa"}">${label}</a>`;
      })
      .join("")}
  </nav>`;
}
