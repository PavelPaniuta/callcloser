const base = () => process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3010";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("crm_token");
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = typeof window !== "undefined" ? getToken() : null;
  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const r = await fetch(`${base()}${path}`, { ...init, headers });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}
