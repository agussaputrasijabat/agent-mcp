export type ApiFailure = { ok: false; status: number; code: string; message: string };
export type ApiSuccess<T> = { ok: true; data: T };

export async function api<T>(path: string, init?: RequestInit): Promise<ApiSuccess<T> | ApiFailure> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  try {
    const response = await fetch(path, { ...init, headers });
    const body = (await response.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: body?.error?.code ?? "error",
        message: body?.error?.message ?? "Gagal dimuat.",
      };
    }
    if (!body || !("data" in body) || body.data == null) {
      return { ok: false, status: response.status, code: "invalid_response", message: "Respons server tidak valid." };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, status: 0, code: "network_error", message: "Tidak dapat terhubung ke server." };
  }
}
