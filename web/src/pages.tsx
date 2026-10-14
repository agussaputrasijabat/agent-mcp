import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { Failed, Loading, buttonClass, fieldClass } from "./shell.tsx";

type KeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function KeysPage() {
  const [rows, setRows] = useState<KeyRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  function load() {
    setFailed(false);
    setRows(null);
    api<{ items: KeyRow[] }>("/api/api-keys").then((result) => {
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setRows(result.data.items);
    });
  }

  useEffect(load, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const result = await api<KeyRow & { secret: string }>("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setSecret(result.data.secret);
    setName("");
    load();
  }

  async function revoke(id: string) {
    const result = await api<KeyRow>(`/api/api-keys/${id}/revoke`, { method: "POST", body: "{}" });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    load();
  }

  return (
    <div>
      <h1 className="mt-0">Kunci API</h1>
      <form className="mb-6 flex gap-3" onSubmit={create}>
        <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="nama" />
        <button className={buttonClass} type="submit">Buat</button>
      </form>
      {secret ? (
        <p>
          {secret}
          <br />
          Salin kunci ini sekarang. Kunci tidak ditampilkan lagi.
        </p>
      ) : null}
      {message ? <p className="text-[#a1a1aa]">{message}</p> : null}
      {failed ? <Failed onRetry={load} /> : null}
      {rows === null && !failed ? <Loading /> : null}
      {rows?.length === 0 ? <p className="text-[#a1a1aa]">Belum ada kunci.</p> : null}
      {rows && rows.length > 0 ? (
        <table className="w-full">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="h-10">
                <td>{row.name}</td>
                <td>{row.key_prefix}</td>
                <td>{row.revoked_at ? "dicabut" : ""}</td>
                <td>
                  {row.revoked_at ? null : (
                    <button type="button" className={buttonClass} onClick={() => revoke(row.id)}>Cabut</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

type ClientKey = { id: string; name: string; key_prefix: string; last_used_at: string | null };
type OAuthClient = { client_name: string; last_used_at: string };

export function ClientsPage() {
  const [data, setData] = useState<{ api_keys: ClientKey[]; oauth: OAuthClient[] } | null>(null);
  const [failed, setFailed] = useState(false);

  function load() {
    setFailed(false);
    setData(null);
    api<{ api_keys: ClientKey[]; oauth: OAuthClient[] }>("/api/clients").then((result) => {
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setData(result.data);
    });
  }

  useEffect(load, []);
  if (failed) return <Failed onRetry={load} />;
  if (!data) return <Loading />;
  if (data.api_keys.length === 0 && data.oauth.length === 0) return <p className="text-[#a1a1aa]">Belum ada klien.</p>;
  return (
    <div>
      <h1 className="mt-0">Klien</h1>
      <table className="w-full">
        <tbody>
          {data.api_keys.map((row) => (
            <tr key={row.id} className="h-10">
              <td>{row.name}</td>
              <td>{row.key_prefix}</td>
              <td>{row.last_used_at ?? "belum dipakai"}</td>
            </tr>
          ))}
          {data.oauth.map((row) => (
            <tr key={row.client_name} className="h-10">
              <td>{row.client_name}</td>
              <td>oauth</td>
              <td>{row.last_used_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Settings = {
  public_base_url: string;
  shell_concurrency_limit: number;
  shell_timeout_ms: number;
  shell_timeout_max_ms: number;
};

export function SettingsPage() {
  const [form, setForm] = useState<Settings | null>(null);
  const [savedUrl, setSavedUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");

  function load() {
    setFailed(false);
    setForm(null);
    api<Settings>("/api/settings").then((result) => {
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setForm(result.data);
      setSavedUrl(result.data.public_base_url);
    });
  }

  useEffect(load, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setMessage("");
    setNotice("");
    const result = await api<Settings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        public_base_url: form.public_base_url,
        shell_concurrency_limit: Number(form.shell_concurrency_limit),
        shell_timeout_ms: Number(form.shell_timeout_ms),
        shell_timeout_max_ms: Number(form.shell_timeout_max_ms),
      }),
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setForm(result.data);
    if (result.data.public_base_url !== savedUrl) {
      setSavedUrl(result.data.public_base_url);
      setNotice("Klien OAuth yang sudah terhubung perlu disambungkan ulang.");
    }
  }

  if (failed) return <Failed onRetry={load} />;
  if (!form) return <Loading />;
  return (
    <form className="grid max-w-xl gap-3" onSubmit={save}>
      <h1 className="mt-0">Pengaturan</h1>
      <label>URL publik <input className={fieldClass} value={form.public_base_url} onChange={(event) => setForm({ ...form, public_base_url: event.target.value })} /></label>
      <label>Batas shell <input className={fieldClass} type="number" value={form.shell_concurrency_limit} onChange={(event) => setForm({ ...form, shell_concurrency_limit: Number(event.target.value) })} /></label>
      <label>Timeout shell <input className={fieldClass} type="number" value={form.shell_timeout_ms} onChange={(event) => setForm({ ...form, shell_timeout_ms: Number(event.target.value) })} /></label>
      <label>Timeout maksimum <input className={fieldClass} type="number" value={form.shell_timeout_max_ms} onChange={(event) => setForm({ ...form, shell_timeout_max_ms: Number(event.target.value) })} /></label>
      <button className={buttonClass} type="submit">Simpan</button>
      {message ? <p className="text-[#a1a1aa]">{message}</p> : null}
      {notice ? <p>{notice}</p> : null}
    </form>
  );
}

type MemoryRow = { key: string; body: string; project_path: string | null; updated_at: string };

export function MemoriesPage() {
  const [rows, setRows] = useState<MemoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState("");
  const [body, setBody] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    setFailed(false);
    setRows(null);
    api<{ items: MemoryRow[] }>("/api/memories").then((result) => {
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setRows(result.data.items);
    });
  }

  useEffect(load, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const result = await api<MemoryRow>("/api/memories", {
      method: "POST",
      body: JSON.stringify({ key, body, project_path: projectPath }),
    });
    if (!result.ok) {
      setMessage(result.code === "invalid_key" ? "Key hanya huruf kecil, angka, dan tanda hubung." : result.message);
      return;
    }
    setKey("");
    setBody("");
    setProjectPath("");
    load();
  }

  async function remove(memoryKey: string) {
    const result = await api<{ ok: boolean }>(`/api/memories/${memoryKey}`, { method: "DELETE" });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    load();
  }

  return (
    <div>
      <h1 className="mt-0">Memori</h1>
      <form className="mb-6 grid max-w-xl gap-3" onSubmit={save}>
        <input className={fieldClass} value={key} onChange={(event) => setKey(event.target.value)} placeholder="key" />
        <textarea className="min-h-24 rounded-[8px] bg-[#09090b] p-3 text-[#fafafa]" value={body} onChange={(event) => setBody(event.target.value)} placeholder="body" />
        <input className={fieldClass} value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="project path" />
        <button className={buttonClass} type="submit">Simpan</button>
      </form>
      {message ? <p className="text-[#a1a1aa]">{message}</p> : null}
      {failed ? <Failed onRetry={load} /> : null}
      {rows === null && !failed ? <Loading /> : null}
      {rows?.length === 0 ? <p>Belum ada memori.</p> : null}
      {rows?.map((row) => (
        <div key={row.key} className="flex h-10 items-center gap-4">
          <span>{row.key}</span>
          <span className="text-[#a1a1aa]">{row.project_path ?? ""}</span>
          <span className="text-[#a1a1aa]">{row.body.slice(0, 120)}</span>
          <button type="button" className={buttonClass} onClick={() => remove(row.key)}>Hapus</button>
        </div>
      ))}
    </div>
  );
}

type SkillListItem = { name: string; description: string; updated_at: string };
type Skill = SkillListItem & { body: string };

export function SkillsPage() {
  const [rows, setRows] = useState<SkillListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  function load() {
    setFailed(false);
    setRows(null);
    api<{ items: SkillListItem[] }>("/api/skills").then((result) => {
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setRows(result.data.items);
    });
  }

  useEffect(load, []);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="mt-0">Skill</h1>
        <a className={`${buttonClass} inline-flex items-center no-underline`} href="/skills/new">Baru</a>
      </div>
      {failed ? <Failed onRetry={load} /> : null}
      {rows === null && !failed ? <Loading /> : null}
      {rows?.length === 0 ? <p>Belum ada skill.</p> : null}
      {rows?.map((row) => (
        <a key={row.name} href={`/skills/${row.name}`} className="flex h-10 items-center gap-4 text-[#fafafa] no-underline">
          <span>{row.name}</span>
          <span className="text-[#a1a1aa]">{row.description}</span>
        </a>
      ))}
    </div>
  );
}

export function SkillEditor({ name }: { name?: string }) {
  const [skill, setSkill] = useState<Skill>({ name: name ?? "", description: "", body: "", updated_at: "" });
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(name));
  const [message, setMessage] = useState("");

  function load() {
    if (!name) return;
    setLoading(true);
    setFailed(false);
    setMissing(false);
    api<Skill>(`/api/skills/${name}`).then((result) => {
      setLoading(false);
      if (!result.ok) {
        if (result.status === 404) setMissing(true);
        else setFailed(true);
        return;
      }
      setSkill(result.data);
    });
  }

  useEffect(load, [name]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const result = await api<Skill>("/api/skills", {
      method: "POST",
      body: JSON.stringify({ name: skill.name, description: skill.description, body: skill.body }),
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    window.location.assign(`/skills/${result.data.name}`);
  }

  if (missing) return <p>Skill ini tidak ada.</p>;
  if (failed) return <Failed onRetry={load} />;
  if (loading) return <Loading />;
  return (
    <form className="grid max-w-3xl gap-3" onSubmit={save}>
      <h1 className="mt-0">{name ? skill.name : "Skill baru"}</h1>
      <input className={fieldClass} value={skill.name} onChange={(event) => setSkill({ ...skill, name: event.target.value })} placeholder="name" />
      <input className={fieldClass} value={skill.description} onChange={(event) => setSkill({ ...skill, description: event.target.value })} placeholder="description" />
      <textarea className="min-h-64 rounded-[8px] bg-[#09090b] p-3 font-mono text-[#fafafa]" value={skill.body} onChange={(event) => setSkill({ ...skill, body: event.target.value })} />
      <button className={buttonClass} type="submit">Simpan</button>
      {message ? <p className="text-[#a1a1aa]">{message}</p> : null}
    </form>
  );
}
