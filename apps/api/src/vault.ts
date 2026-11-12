import type { Env } from "./types";

/**
 * Cofre de credenciais: AES-GCM com a chave CREDENTIALS_KEY (32 bytes em base64, secret do Worker).
 * Sem a chave, nada é guardado (nunca cai para texto puro).
 */
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const vaultReady = (env: Env) => {
  try {
    return !!env.CREDENTIALS_KEY && unb64(env.CREDENTIALS_KEY).length === 32;
  } catch {
    return false;
  }
};

async function key(env: Env, usage: Array<"encrypt" | "decrypt">) {
  if (!vaultReady(env)) throw new Error("vault_not_configured");
  return crypto.subtle.importKey("raw", unb64(env.CREDENTIALS_KEY!), "AES-GCM", false, usage);
}

export async function seal(env: Env, data: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env, ["encrypt"]), new TextEncoder().encode(JSON.stringify(data))));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function open<T = Record<string, unknown>>(env: Env, sealed: string | null): Promise<T | null> {
  if (!sealed) return null;
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(env, ["decrypt"]), unb64(ct));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}
