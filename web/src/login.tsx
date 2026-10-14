import { useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { contentColumnClass } from "./shell.tsx";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LoginPage() {
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    const password = String(new FormData(form).get("password") ?? "");
    const oauthQuery = location.search.startsWith("?") ? location.search.slice(1) : "";
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
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className={cn(contentColumnClass, "flex justify-center")}>
      <div className="flex w-full max-w-sm flex-col gap-4">
        <p className="m-0 text-sm font-medium tracking-tight">Agent</p>
        <Card>
          <CardHeader>
            <CardTitle><h1>Masuk</h1></CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <FieldGroup className="gap-3">
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input id="email" name="email" type="email" autoComplete="username" required />
                </Field>
                <Field data-invalid={failed ? true : undefined}>
                  <FieldLabel htmlFor="password">Kata sandi</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    aria-invalid={failed ? true : undefined}
                  />
                </Field>
                {failed ? <FieldError>Nama atau kata sandi salah.</FieldError> : null}
              </FieldGroup>
              <Button className="w-full" type="submit">Masuk</Button>
            </form>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
