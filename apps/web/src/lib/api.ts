// All requests go through Next.js rewrites → gateway (no localhost in browser)
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("crm_token") ?? getCookie("crm_token");
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function setToken(token: string) {
  localStorage.setItem("crm_token", token);
  // Also set cookie so middleware can protect routes server-side
  const maxAge = 60 * 60 * 12; // 12 hours
  document.cookie = `crm_token=${encodeURIComponent(token)}; path=/; max-age=${maxAge}; SameSite=Strict`;
}

export function clearToken() {
  localStorage.removeItem("crm_token");
  document.cookie = "crm_token=; path=/; max-age=0";
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
  // Relative URL — goes through Next.js rewrites proxy
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}
