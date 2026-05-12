export interface Handshake {
  host: string;
  port: number;
  token: string;
  version: string;
}

export interface RequestPayload {
  protocol: string;
  target: string;
  headers?: Record<string, string>;
  body?: string | null;
  body_encoding?: "utf-8" | "base64";
  meta?: Record<string, unknown>;
  expect?: string[];
}

export interface ResponsePayload {
  status: number | string;
  headers: Record<string, string>;
  body: string | null;
  body_encoding: "utf-8" | "base64" | null;
  timing_ms: number;
  meta: Record<string, unknown>;
}

export interface ConversationEvent {
  direction: "send" | "recv" | "info";
  data: string;
  ts: number;
}

export interface AssertionResult {
  expr: string;
  passed: boolean;
  error: string | null;
}

export interface RequestResult {
  response: ResponsePayload;
  events: ConversationEvent[];
  assertions: AssertionResult[];
  passed: boolean;
}

export interface ProtocolMeta {
  name: string;
  class: string;
  module: string;
}

export interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "changed" | "type_changed";
  left: unknown;
  right: unknown;
}
