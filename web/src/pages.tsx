import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { EmptyState, Failed, LoadingRows } from "./shell.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle><h1>Kunci API</h1></CardTitle>
          <CardDescription>
            Endpoint MCP adalah alamat situs ini ditambah /mcp, yaitu <span className="font-mono break-all">{`${window.location.origin}/mcp`}</span>. Konektor tanpa kolom OAuth bisa menaruh kunci di query sebagai ?api_key=.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create}>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="key-name">Nama</FieldLabel>
                <Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Button className="w-fit" type="submit">Buat</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      {secret ? (
        <Alert>
          <AlertTitle className="font-mono break-all">{secret}</AlertTitle>
          <AlertDescription>Salin kunci ini sekarang. Kunci tidak ditampilkan lagi.</AlertDescription>
        </Alert>
      ) : null}
      {message ? <p className="text-destructive">{message}</p> : null}
      <Card>
        <CardContent className="flex flex-col gap-3">
          {failed ? <Failed onRetry={load} /> : null}
          {rows === null && !failed ? <LoadingRows /> : null}
          {rows?.length === 0 ? <EmptyState>Belum ada kunci.</EmptyState> : null}
          {rows && rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Awalan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="font-mono">{row.key_prefix}</TableCell>
                    <TableCell>{row.revoked_at ? "dicabut" : ""}</TableCell>
                    <TableCell>
                      {row.revoked_at ? null : (
                        <Button type="button" onClick={() => revoke(row.id)}>Cabut</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
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
  const empty = data !== null && data.api_keys.length === 0 && data.oauth.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle><h1>Klien</h1></CardTitle>
      </CardHeader>
      <CardContent>
        {failed ? <Failed onRetry={load} /> : null}
        {!data && !failed ? <LoadingRows /> : null}
        {empty ? <EmptyState>Belum ada klien.</EmptyState> : null}
        {data && !empty ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Terakhir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.api_keys.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="font-mono">{row.key_prefix}</TableCell>
                  <TableCell>{row.last_used_at ?? "belum dipakai"}</TableCell>
                </TableRow>
              ))}
              {data.oauth.map((row) => (
                <TableRow key={row.client_name}>
                  <TableCell>{row.client_name}</TableCell>
                  <TableCell>oauth</TableCell>
                  <TableCell>{row.last_used_at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle><h1>Pengaturan</h1></CardTitle>
      </CardHeader>
      <CardContent>
        {failed ? <Failed onRetry={load} /> : null}
        {!form && !failed ? <LoadingRows /> : null}
        {form ? (
          <form onSubmit={save}>
            <FieldGroup className="max-w-xl gap-3">
              <Field>
                <FieldLabel htmlFor="public-url">URL publik</FieldLabel>
                <Input id="public-url" value={form.public_base_url} onChange={(event) => setForm({ ...form, public_base_url: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="shell-limit">Batas shell</FieldLabel>
                <Input id="shell-limit" type="number" value={form.shell_concurrency_limit} onChange={(event) => setForm({ ...form, shell_concurrency_limit: Number(event.target.value) })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="shell-timeout">Timeout shell</FieldLabel>
                <Input id="shell-timeout" type="number" value={form.shell_timeout_ms} onChange={(event) => setForm({ ...form, shell_timeout_ms: Number(event.target.value) })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="shell-timeout-max">Timeout maksimum</FieldLabel>
                <Input id="shell-timeout-max" type="number" value={form.shell_timeout_max_ms} onChange={(event) => setForm({ ...form, shell_timeout_max_ms: Number(event.target.value) })} />
              </Field>
              <Button className="w-fit" type="submit">Simpan</Button>
              {message ? <p className="text-destructive">{message}</p> : null}
              {notice ? (
                <Alert>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </form>
        ) : null}
      </CardContent>
    </Card>
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
    const result = await api<{ ok: boolean }>(`/api/memories/${encodeURIComponent(memoryKey)}`, { method: "DELETE" });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle><h1>Memori</h1></CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save}>
            <FieldGroup className="max-w-xl gap-3">
              <Field>
                <FieldLabel htmlFor="memory-key">Key</FieldLabel>
                <Input id="memory-key" value={key} onChange={(event) => setKey(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="memory-body">Isi</FieldLabel>
                <Textarea id="memory-body" value={body} onChange={(event) => setBody(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="memory-path">Path proyek</FieldLabel>
                <Input id="memory-path" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
              </Field>
              <Button className="w-fit" type="submit">Simpan</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      {message ? <p className="text-destructive">{message}</p> : null}
      <Card>
        <CardContent className="flex flex-col gap-3">
          {failed ? <Failed onRetry={load} /> : null}
          {rows === null && !failed ? <LoadingRows /> : null}
          {rows?.length === 0 ? <EmptyState>Belum ada memori.</EmptyState> : null}
          {rows && rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Cuplikan</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key}</TableCell>
                    <TableCell className="max-w-40 truncate text-muted-foreground">{row.project_path ?? ""}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">{row.body.slice(0, 120)}</TableCell>
                    <TableCell>
                      <Button type="button" onClick={() => remove(row.key)}>Hapus</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
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
    <Card>
      <CardHeader>
        <CardTitle><h1>Skill</h1></CardTitle>
        <CardAction>
          <Button asChild>
            <a href="/skills/new">Baru</a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {failed ? <Failed onRetry={load} /> : null}
        {rows === null && !failed ? <LoadingRows /> : null}
        {rows?.length === 0 ? <EmptyState>Belum ada skill.</EmptyState> : null}
        {rows && rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Deskripsi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>
                    <a className="text-foreground underline-offset-4 hover:text-primary" href={`/skills/${encodeURIComponent(row.name)}`}>
                      {row.name}
                    </a>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">{row.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
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
    api<Skill>(`/api/skills/${encodeURIComponent(name)}`).then((result) => {
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
    window.location.assign(`/skills/${encodeURIComponent(result.data.name)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle><h1>{name ? skill.name || name : "Skill baru"}</h1></CardTitle>
      </CardHeader>
      <CardContent>
        {missing ? <p>Skill ini tidak ada.</p> : null}
        {failed ? <Failed onRetry={load} /> : null}
        {loading ? <LoadingRows /> : null}
        {!missing && !failed && !loading ? (
          <form onSubmit={save}>
            <FieldGroup className="max-w-3xl gap-3">
              <Field>
                <FieldLabel htmlFor="skill-name">Nama</FieldLabel>
                <Input id="skill-name" value={skill.name} onChange={(event) => setSkill({ ...skill, name: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-description">Deskripsi</FieldLabel>
                <Input id="skill-description" value={skill.description} onChange={(event) => setSkill({ ...skill, description: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-body">Isi</FieldLabel>
                <Textarea id="skill-body" className="min-h-64 font-mono" value={skill.body} onChange={(event) => setSkill({ ...skill, body: event.target.value })} />
              </Field>
              <Button className="w-fit" type="submit">Simpan</Button>
              {message ? <p className="text-destructive">{message}</p> : null}
            </FieldGroup>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
