import { useState, type FormEvent } from "react";
import { Eye, EyeSlash, Fingerprint, Lightning, LockKey, PlugsConnected } from "@phosphor-icons/react";
import { api } from "./api.ts";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LoginPage() {
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    const password = String(new FormData(form).get("password") ?? "");
    const oauthQuery = location.search.startsWith("?") ? location.search.slice(1) : "";
    try {
      const result = await api<{ redirect: string | null }>("/api/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          ...(oauthQuery.includes("sig=") ? { oauth_query: oauthQuery } : {}),
        }),
      });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      location.href = result.data.redirect || "/";
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className="relative hidden min-h-dvh flex-col justify-between overflow-hidden border-r border-border bg-sidebar p-12 lg:flex xl:p-16">
        <div className="pointer-events-none absolute right-[-15%] bottom-[-25%] size-[70vw] max-h-[850px] max-w-[850px] rounded-full border border-primary/10" aria-hidden="true">
          <div className="absolute inset-[14%] rounded-full border border-primary/10" />
          <div className="absolute inset-[28%] rounded-full border border-primary/15" />
          <div className="absolute inset-[42%] rounded-full bg-primary/[0.06]" />
        </div>
        <a className="relative flex w-fit items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4" href="/">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <img src="/favicon.svg" alt="" className="size-8" width={32} height={32} />
          </span>
          <span className="text-base font-semibold tracking-tight">Agent MCP</span>
        </a>
        <div className="relative max-w-[35rem] pb-10">
          <p className="mb-5 text-xs font-semibold tracking-[0.15em] text-primary uppercase">Operator console</p>
          <h2 className="text-[clamp(2.8rem,4.5vw,4.8rem)] leading-[1.08] font-semibold tracking-[-0.065em]">
            Satu koneksi.<br />Lebih banyak kendali.
          </h2>
          <p className="mt-7 max-w-md text-base leading-7 text-muted-foreground">
            Hubungkan ChatGPT atau Claude ke file, shell, memori, dan skill di mesinmu melalui Agent MCP.
          </p>
          <div className="mt-12 flex flex-col gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-3"><Lightning size={19} className="text-primary" /> Panggilan tool dan sesi dalam satu tempat</div>
            <div className="flex items-center gap-3"><PlugsConnected size={19} className="text-primary" /> Kelola koneksi dan kredensial</div>
            <div className="flex items-center gap-3"><Fingerprint size={19} className="text-primary" /> Konsol khusus operator</div>
          </div>
        </div>
        <p className="relative text-xs text-muted-foreground">Agent MCP · Self-hosted operator console</p>
      </section>

      <section className="flex min-h-dvh flex-col justify-center px-6 py-16 sm:px-12 lg:px-[clamp(3rem,6vw,8rem)]">
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-10" width={40} height={40} />
            <span className="text-lg font-semibold">Agent MCP</span>
          </div>
          <span className="mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-card text-primary"><LockKey size={22} weight="bold" /></span>
          <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.045em]">Selamat datang kembali</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Masuk dengan akun operator untuk mengakses dashboard.
          </p>
          <form className="mt-9 flex flex-col gap-6" onSubmit={(event) => void submit(event)}>
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="username" placeholder="operator@example.com" required />
              </Field>
              <Field data-invalid={failed ? true : undefined}>
                <FieldLabel htmlFor="password">Kata sandi</FieldLabel>
                <div className="relative">
                  <Input id="password" name="password" type={visible ? "text" : "password"} autoComplete="current-password"
                    required aria-invalid={failed ? true : undefined} className="pr-12" />
                  <button type="button" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2"
                    aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} aria-pressed={visible} onClick={() => setVisible(!visible)}>
                    {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
              {failed ? <FieldError role="alert">Tidak dapat masuk. Periksa email, kata sandi, dan koneksi server.</FieldError> : null}
            </FieldGroup>
            <Button className="w-full" type="submit" size="lg" disabled={pending}>{pending ? "Memeriksa akun…" : "Masuk ke dashboard"}</Button>
          </form>
          <p className="mt-12 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            Hanya untuk operator Agent MCP. Kredensial dikelola pada server yang kamu jalankan.
          </p>
        </div>
      </section>
    </main>
  );
}
