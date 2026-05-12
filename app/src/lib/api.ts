import type {
  Handshake,
  ProtocolMeta,
  RequestPayload,
  RequestResult,
  ResponsePayload,
  DiffEntry,
} from "./types";

let handshake: Handshake | null = null;

export function setHandshake(h: Handshake) {
  handshake = h;
}

export function baseUrl() {
  if (!handshake) throw new Error("daemon not connected");
  return `http://${handshake.host}:${handshake.port}`;
}

export function authToken() {
  if (!handshake) throw new Error("daemon not connected");
  return handshake.token;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(baseUrl() + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authToken()}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface ProfileAuth {
  kind: string;
  config: Record<string, unknown>;
}

export interface Profile {
  vars: Record<string, unknown>;
  auth?: ProfileAuth;
}

export interface ProfilesFile {
  profiles: Record<string, Profile>;
}

export const api = {
  health: () => fetch(baseUrl() + "/health").then((r) => r.json()),
  protocols: () => call<{ protocols: ProtocolMeta[] }>("/protocols"),
  fire: (payload: RequestPayload) =>
    call<RequestResult>("/requests", { method: "POST", body: JSON.stringify(payload) }),
  diff: (requests: RequestPayload[]) =>
    call<{ responses: ResponsePayload[]; diff: { status: { left: unknown; right: unknown; equal: boolean }; headers: DiffEntry[]; body: DiffEntry[] } }>(
      "/diff",
      { method: "POST", body: JSON.stringify({ requests }) }
    ),
  profiles: {
    list: () => call<ProfilesFile>("/profiles"),
    upsert: (name: string, vars: Record<string, unknown>, auth?: ProfileAuth | null) =>
      call<{ ok: boolean; name: string }>(`/profiles/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify({ vars, auth: auth ?? null }),
      }),
    delete: (name: string) =>
      call<{ ok: boolean; name: string }>(`/profiles/${encodeURIComponent(name)}`, { method: "DELETE" }),
  },
};
