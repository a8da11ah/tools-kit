import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { streamRequest } from "../lib/ws";
import type {
  AssertionResult,
  ConversationEvent,
  RequestPayload,
  ResponsePayload,
} from "../lib/types";
import ConversationLog from "../components/ConversationLog";
import ResponsePane    from "../components/ResponsePane";
import QueryParamsEditor from "../components/http/QueryParamsEditor";
import AuthEditor, {
  type AuthConfig,
  AUTH_NONE,
  authToHeaders,
  authQueryParam,
} from "../components/http/AuthEditor";
import BodyEditor, {
  type BodyType,
  type FormField,
  type MultipartPart,
  type GraphqlBody,
  serializeForm,
  serializeGraphql,
  serializeMultipart,
} from "../components/http/BodyEditor";
import { useHistory }  from "../store/history";
import { useProfiles } from "../store/profile";
import { interpolatePayload, unresolvedInPayload } from "../lib/interpolate";
import { parseCurl }   from "../lib/curlimport";
import { generateCurl, generateFetch, generatePython } from "../lib/codegen";
import Spinner from "../components/Spinner";
import { toast } from "../store/toasts";
import { useCollections } from "../store/collections";
import { usePendingLoad } from "../store/pendingLoad";
import { useCookies } from "../store/cookies";
import CollectionsPanel from "../components/http/CollectionsPanel";
import SaveRequestModal from "../components/http/SaveRequestModal";
import ImportOpenApiModal from "../components/http/ImportOpenApiModal";
import { validateHttpRequest, hasErrors, type ValidationIssue } from "../lib/validate";

// ── Constants ─────────────────────────────────────────────────────────────────

const PROTOCOLS_WITH_ASSERTIONS = new Set(["http", "redis", "dns", "smtp", "ssh", "mqtt"]);

const DEFAULTS: Record<string, RequestPayload> = {
  http: {
    protocol: "http",
    target:   "https://httpbin.org/get",
    headers:  {},
    body:     null,
    meta:     { method: "GET", http2: true, verify: true, timeout: 30 },
    expect:   [],
  },
  redis: { protocol: "redis", target: "redis://localhost:6379", meta: { command: ["PING"] } },
  dns:   { protocol: "dns",   target: "example.com", meta: { rtype: "A" } },
  smtp: {
    protocol: "smtp",
    target:   "smtp://localhost:25",
    body:     "",
    meta:     { to: "", from: "xray@localhost", subject: "test", timeout: 10 },
  },
  ssh: {
    protocol: "ssh",
    target:   "ssh://user@localhost:22",
    meta:     { command: "echo hello", known_hosts: null },
  },
  mqtt: {
    protocol: "mqtt",
    target:   "mqtt://localhost:1883",
    body:     "",
    meta:     { action: "publish", topic: "xray/test", qos: 0, wait_ms: 2000, timeout: 10 },
  },
};

// HTTP request tabs
type HttpTab = "params" | "headers" | "auth" | "body" | "assertions";

// ── Component ─────────────────────────────────────────────────────────────────

export default function RequestPage() {
  const protocols  = useQuery({ queryKey: ["protocols"], queryFn: api.protocols });
  const pushHistory = useHistory((s) => s.push);
  const { profiles, activeName, setActive, activeVars, load: loadProfiles } = useProfiles();

  // ── Core request state ────────────────────────────────────────────────────
  const [protocol,   setProtocol]   = useState<string>("http");
  const [payload,    setPayload]    = useState<RequestPayload>(DEFAULTS.http);
  const [running,    setRunning]    = useState(false);
  const [events,     setEvents]     = useState<ConversationEvent[]>([]);
  const [response,   setResponse]   = useState<ResponsePayload | null>(null);
  const [assertions, setAssertions] = useState<AssertionResult[]>([]);
  const [tab,        setTab]        = useState<"response" | "log">("response");

  // ── HTTP-specific state ───────────────────────────────────────────────────
  const [httpTab,    setHttpTab]    = useState<HttpTab>("params");
  const [auth,       setAuth]       = useState<AuthConfig>(AUTH_NONE);
  const [bodyType,   setBodyType]   = useState<BodyType>("none");
  const [bodyText,   setBodyText]   = useState("");
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [multipartParts, setMultipartParts] = useState<MultipartPart[]>([]);
  const [graphql, setGraphql] = useState<GraphqlBody>({ query: "", variables: "" });

  // ── Codegen state ─────────────────────────────────────────────────────────
  const [codegenOpen,   setCodegenOpen]   = useState(false);
  const [codegenTarget, setCodegenTarget] = useState<"curl" | "fetch" | "python">("curl");

  // ── cURL import state ─────────────────────────────────────────────────────
  const [curlModalOpen, setCurlModalOpen] = useState(false);
  const [curlInput,     setCurlInput]     = useState("");
  const [curlError,     setCurlError]     = useState("");

  // ── Collections state ─────────────────────────────────────────────────────
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [saveModalOpen,   setSaveModalOpen]   = useState(false);
  const [openApiOpen,     setOpenApiOpen]     = useState(false);
  /** When non-null, saving will update this existing item. */
  const [editingItemId,   setEditingItemId]   = useState<string | null>(null);
  const [editingName,     setEditingName]     = useState("");
  const [editingFolder,   setEditingFolder]   = useState("");
  const addCollection    = useCollections((s) => s.add);
  const updateCollection = useCollections((s) => s.update);

  // Load profiles once
  useEffect(() => { loadProfiles(); }, []);

  // ── Pending load (from History "Re-run" or Collections "Load") ───────────
  const consumePending = usePendingLoad((s) => s.consume);
  useEffect(() => {
    const p = consumePending();
    if (!p) return;
    setProtocol(p.payload.protocol);
    setPayload(p.payload);
    setEvents([]);
    setResponse(null);
    setAssertions([]);
    // Restore editor state if the source captured it.
    const ed = p.editor ?? {};
    if (ed.auth)       setAuth(ed.auth as AuthConfig);
    else               setAuth(AUTH_NONE);
    if (typeof ed.bodyType === "string") setBodyType(ed.bodyType as BodyType);
    else                                 setBodyType("none");
    setBodyText(typeof ed.bodyText === "string" ? ed.bodyText : "");
    setFormFields(Array.isArray(ed.formFields) ? (ed.formFields as FormField[]) : []);
    toast.info(
      p.source === "history" ? "Loaded from history" : "Loaded from collection",
    );
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const updateMeta = (key: string, value: unknown) =>
    setPayload((p) => ({ ...p, meta: { ...(p.meta ?? {}), [key]: value } }));

  const switchProtocol = (p: string) => {
    setProtocol(p);
    setPayload(DEFAULTS[p] ?? { protocol: p, target: "", meta: {} });
    setEvents([]);
    setResponse(null);
    setAssertions([]);
    setAuth(AUTH_NONE);
    setBodyType("none");
    setBodyText("");
    setFormFields([]);
    setMultipartParts([]);
    setGraphql({ query: "", variables: "" });
  };

  /**
   * Build the final payload to send:
   *  1. Merge explicit headers + auth headers
   *  2. Append apikey query param if needed
   *  3. Set body / body_encoding from bodyType
   *  4. Interpolate {{vars}} from active profile
   */
  const buildEffectivePayload = (): RequestPayload => {
    const authHdrs  = authToHeaders(auth);
    const authParam = authQueryParam(auth);

    // Merge headers: explicit wins over auth
    const mergedHeaders = { ...authHdrs, ...(payload.headers ?? {}) };

    // Body
    let body: string | null = null;
    let bodyEncoding: "utf-8" | "base64" | undefined = undefined;

    if (bodyType === "json" || bodyType === "raw") {
      body = bodyText || null;
      if (bodyType === "json" && !mergedHeaders["Content-Type"] && !mergedHeaders["content-type"]) {
        mergedHeaders["Content-Type"] = "application/json";
      }
    } else if (bodyType === "form") {
      body = serializeForm(formFields) || null;
      if (!mergedHeaders["Content-Type"] && !mergedHeaders["content-type"]) {
        mergedHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      }
    } else if (bodyType === "binary") {
      body = bodyText || null;
      bodyEncoding = "base64";
    } else if (bodyType === "graphql") {
      try {
        body = serializeGraphql(graphql);
      } catch (e) {
        // Surface as a stub body; the validation strip already warned the user.
        body = JSON.stringify({ query: graphql.query, _error: String(e) });
      }
      if (!mergedHeaders["Content-Type"] && !mergedHeaders["content-type"]) {
        mergedHeaders["Content-Type"] = "application/json";
      }
    } else if (bodyType === "multipart") {
      const enabled = multipartParts.filter((p) => p.enabled && p.name);
      if (enabled.length > 0) {
        const { contentType, base64 } = serializeMultipart(multipartParts);
        body = base64;
        bodyEncoding = "base64";
        // Always replace Content-Type — boundary changes each send.
        mergedHeaders["Content-Type"] = contentType;
      }
    }

    // Append apikey query param
    let target = payload.target;
    if (authParam) {
      const sep = target.includes("?") ? "&" : "?";
      target = `${target}${sep}${encodeURIComponent(authParam.key)}=${encodeURIComponent(authParam.value)}`;
    }

    // Auto-merge cookies from the jar. User-set Cookie header wins.
    const hasUserCookie =
      Object.keys(mergedHeaders).some((k) => k.toLowerCase() === "cookie");
    if (!hasUserCookie) {
      const cookieHeader = useCookies.getState().headerFor(target);
      if (cookieHeader) mergedHeaders["Cookie"] = cookieHeader;
    }

    const built: RequestPayload = {
      ...payload,
      target,
      headers:       mergedHeaders,
      body,
      body_encoding: bodyEncoding,
    };

    // Interpolate {{vars}}
    const vars = activeVars();
    return interpolatePayload(built, vars);
  };

  const send = () => {
    setRunning(true);
    const collectedEvents: ConversationEvent[] = [];
    setEvents([]);
    setResponse(null);
    setAssertions([]);
    const effective = buildEffectivePayload();
    streamRequest(effective, {
      onEvent: (e) => {
        collectedEvents.push(e);
        setEvents((prev) => [...prev, e]);
      },
      onResponse: (r, asrts, passed) => {
        setResponse(r);
        setAssertions(asrts);
        pushHistory({ payload: effective, result: { response: r, events: collectedEvents, assertions: asrts, passed } });
        // Capture any Set-Cookie headers for the cookie jar.
        const sc = r.headers["set-cookie"] ?? r.headers["Set-Cookie"];
        if (sc) useCookies.getState().capture(sc, effective.target).catch(() => {});
      },
      onError: (err) => {
        setEvents((prev) => [...prev, { direction: "info", data: `error: ${err}`, ts: Date.now() }]);
        toast.error("Request failed", { detail: String(err) });
      },
      onClose: () => setRunning(false),
    });
  };

  // ── cURL import ────────────────────────────────────────────────────────────

  const applyCurl = () => {
    setCurlError("");
    try {
      const parsed = parseCurl(curlInput);
      if (!parsed.target) throw new Error("Could not find a URL in the curl command.");
      setPayload({ ...DEFAULTS.http, ...parsed, meta: { ...DEFAULTS.http.meta, ...parsed.meta } });
      setProtocol("http");

      // Detect body type from Content-Type header
      const ct = Object.entries(parsed.headers ?? {})
        .find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
      if (ct.includes("application/json")) {
        setBodyType("json");
        setBodyText(parsed.body ?? "");
      } else if (ct.includes("urlencoded")) {
        setBodyType("form");
        // parse form fields
        const fields: FormField[] = (parsed.body ?? "").split("&").filter(Boolean).map((part) => {
          const [k, v = ""] = part.split("=").map(decodeURIComponent);
          return { id: crypto.randomUUID(), key: k, value: v, enabled: true };
        });
        setFormFields(fields);
      } else if (parsed.body) {
        setBodyType("raw");
        setBodyText(parsed.body);
      } else {
        setBodyType("none");
        setBodyText("");
      }

      // Detect auth
      const authHeader = Object.entries(parsed.headers ?? {})
        .find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? "";
      if (authHeader.startsWith("Bearer ")) {
        setAuth({ kind: "bearer", token: authHeader.slice(7) });
        // Remove from explicit headers — managed by auth panel now
        const h = { ...(parsed.headers ?? {}) };
        delete h["Authorization"];
        delete h["authorization"];
        setPayload((p) => ({ ...p, headers: h }));
      } else if (authHeader.startsWith("Basic ")) {
        const decoded = atob(authHeader.slice(6));
        const colon   = decoded.indexOf(":");
        setAuth({
          kind: "basic",
          username: colon >= 0 ? decoded.slice(0, colon) : decoded,
          password: colon >= 0 ? decoded.slice(colon + 1) : "",
        });
        const h = { ...(parsed.headers ?? {}) };
        delete h["Authorization"];
        delete h["authorization"];
        setPayload((p) => ({ ...p, headers: h }));
      }

      setResponse(null);
      setEvents([]);
      setAssertions([]);
      setCurlInput("");
      setCurlModalOpen(false);
    } catch (e) {
      setCurlError(String(e));
    }
  };

  // ── Unresolved variable warning ────────────────────────────────────────────
  const vars       = activeVars();
  const unresolved = unresolvedInPayload(payload, vars);

  // ── Validation (HTTP only) ────────────────────────────────────────────────
  const issues: ValidationIssue[] = protocol === "http"
    ? validateHttpRequest(payload, bodyType, bodyText)
    : [];
  const blocked = hasErrors(issues);

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── Save handler (used by SaveRequestModal) ───────────────────────────────
  const handleSaveCollection = async (name: string, folder: string) => {
    const editor = { auth, bodyType, bodyText, formFields };
    if (editingItemId) {
      await updateCollection(editingItemId, { name, folder, payload, editor });
    } else {
      const id = await addCollection({ name, folder, payload, editor });
      setEditingItemId(id);
      setEditingName(name);
      setEditingFolder(folder);
    }
  };

  return (
    <div className="flex h-full">
      {collectionsOpen && (
        <CollectionsPanel
          onLoad={(item) => {
            setProtocol(item.payload.protocol);
            setPayload(item.payload);
            setEvents([]);
            setResponse(null);
            setAssertions([]);
            const ed = item.editor ?? {};
            setAuth((ed.auth as AuthConfig) ?? AUTH_NONE);
            setBodyType((ed.bodyType as BodyType) ?? "none");
            setBodyText(typeof ed.bodyText === "string" ? ed.bodyText : "");
            setFormFields(Array.isArray(ed.formFields) ? (ed.formFields as FormField[]) : []);
            setEditingItemId(item.id);
            setEditingName(item.name);
            setEditingFolder(item.folder);
            toast.info(`Loaded "${item.name}"`);
          }}
        />
      )}

      <div className="flex h-full min-w-0 flex-1 flex-col">

      {/* ── Top toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-sm">

        {/* Collections toggle */}
        <button
          onClick={() => setCollectionsOpen((v) => !v)}
          title={collectionsOpen ? "Hide collections" : "Show collections"}
          aria-pressed={collectionsOpen}
          className={`rounded border px-2 py-1 font-mono text-xs ${
            collectionsOpen
              ? "border-cyan-600 bg-cyan-950/40 text-cyan-200"
              : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          ☰
        </button>

        {/* Protocol selector */}
        <select
          value={protocol}
          onChange={(e) => switchProtocol(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
        >
          {(protocols.data?.protocols ?? []).map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>

        {/* HTTP method */}
        {protocol === "http" && (
          <select
            value={String(payload.meta?.method ?? "GET")}
            onChange={(e) => updateMeta("method", e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
          >
            {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}

        {/* URL input */}
        <div className="relative flex-1">
          <input
            data-shortcut="url"
            value={payload.target}
            onChange={(e) => setPayload({ ...payload, target: e.target.value })}
            placeholder="target / URL"
            className={`w-full rounded border bg-zinc-900 px-3 py-1 font-mono text-xs ${
              unresolved.length > 0 ? "border-amber-700" : "border-zinc-700"
            }`}
          />
          {unresolved.length > 0 && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-amber-500">
              {unresolved.map((v) => `{{${v}}}`).join(", ")} unresolved
            </span>
          )}
        </div>

        {/* Profile selector */}
        {protocol === "http" && (
          <select
            value={activeName ?? ""}
            onChange={(e) => setActive(e.target.value || null)}
            title="Active variable profile"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-400"
          >
            <option value="">— no profile —</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        )}

        {/* Send */}
        <button
          onClick={send}
          disabled={running || blocked}
          title={blocked ? issues.find((i) => i.severity === "error")?.message : undefined}
          className="inline-flex items-center gap-1.5 rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running && <Spinner size={12} className="text-zinc-950" />}
          {running ? "Sending…" : "Send"}
        </button>

        {/* HTTP extras */}
        {protocol === "http" && (
          <>
            {/* Save to collection */}
            <button
              onClick={() => setSaveModalOpen(true)}
              title={editingItemId ? `Update "${editingName}"` : "Save to collection"}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              {editingItemId ? "Update" : "Save"}
            </button>

            {/* Import cURL */}
            <button
              onClick={() => { setCurlModalOpen(true); setCurlError(""); }}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              Import cURL
            </button>

            {/* Import OpenAPI */}
            <button
              onClick={() => setOpenApiOpen(true)}
              title="Import an OpenAPI 3.x or Swagger 2.0 spec into Collections"
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              Import OpenAPI
            </button>

            {/* Copy as */}
            <div className="relative">
              <button
                onClick={() => setCodegenOpen(!codegenOpen)}
                className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Copy as…
              </button>
              {codegenOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-[420px] overflow-hidden rounded border border-zinc-700 bg-zinc-900 shadow-xl">
                  <div className="flex border-b border-zinc-800 bg-zinc-950/50">
                    {(["curl", "fetch", "python"] as const).map((tgt) => (
                      <button
                        key={tgt}
                        onClick={() => setCodegenTarget(tgt)}
                        className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${
                          codegenTarget === tgt ? "bg-zinc-800 text-cyan-400" : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {tgt}
                      </button>
                    ))}
                  </div>
                  <div className="p-3">
                    <textarea
                      readOnly
                      value={
                        codegenTarget === "curl"   ? generateCurl(buildEffectivePayload())
                        : codegenTarget === "fetch" ? generateFetch(buildEffectivePayload())
                        : generatePython(buildEffectivePayload())
                      }
                      className="h-32 w-full resize-none rounded border border-zinc-800 bg-black/50 p-2 font-mono text-[10px] text-zinc-300 outline-none"
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => {
                          const ep = buildEffectivePayload();
                          const code =
                            codegenTarget === "curl"   ? generateCurl(ep)
                            : codegenTarget === "fetch" ? generateFetch(ep)
                            : generatePython(ep);
                          navigator.clipboard.writeText(code);
                          setCodegenOpen(false);
                        }}
                        className="rounded bg-zinc-700 px-3 py-1 text-xs font-medium hover:bg-zinc-600"
                      >
                        Copy to Clipboard
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Validation strip ── */}
      {issues.length > 0 && (
        <div className="border-b border-zinc-800 bg-zinc-950/50 px-3 py-1.5">
          {issues.map((iss, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-[11px] ${
                iss.severity === "error" ? "text-rose-300" : "text-amber-300"
              }`}
            >
              <span className="font-mono">{iss.severity === "error" ? "✕" : "!"}</span>
              <span>
                <span className="font-mono text-zinc-500">[{iss.field}]</span> {iss.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── cURL import modal ── */}
      {curlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[560px] rounded border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <span className="text-sm font-semibold text-zinc-200">Import from cURL</span>
              <button onClick={() => setCurlModalOpen(false)} className="text-zinc-500 hover:text-zinc-300">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-zinc-500">
                Paste a curl command. Method, URL, headers, body, and basic auth will be parsed automatically.
              </p>
              <textarea
                value={curlInput}
                onChange={(e) => setCurlInput(e.target.value)}
                placeholder={`curl -X POST "https://api.example.com/v1/items" \\\n  -H "Authorization: Bearer sk-…" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"test"}'`}
                rows={7}
                className="w-full rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-700"
              />
              {curlError && (
                <p className="text-xs text-red-400">{curlError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCurlModalOpen(false)}
                  className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  onClick={applyCurl}
                  className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500"
                >
                  Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── HTTP tabbed input panel ── */}
      {protocol === "http" && (
        <div className="border-b border-zinc-800">
          {/* Tab bar */}
          <div className="flex border-b border-zinc-800 bg-zinc-950/30">
            {(["params", "headers", "auth", "body", "assertions"] as HttpTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setHttpTab(t)}
                className={`px-4 py-2 text-xs font-medium capitalize transition-colors ${
                  httpTab === t
                    ? "border-b-2 border-cyan-400 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t}
                {t === "auth" && auth.kind !== "none" && (
                  <span className="ml-1.5 rounded-full bg-cyan-700 px-1 py-0.5 text-[9px] text-cyan-200">
                    ON
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-3">

            {httpTab === "params" && (
              <QueryParamsEditor
                url={payload.target}
                onUrlChange={(url) => setPayload({ ...payload, target: url })}
              />
            )}

            {httpTab === "headers" && (
              <HeadersEditor
                headers={payload.headers ?? {}}
                onChange={(h) => setPayload({ ...payload, headers: h })}
              />
            )}

            {httpTab === "auth" && (
              <AuthEditor auth={auth} onChange={setAuth} />
            )}

            {httpTab === "body" && (
              <BodyEditor
                bodyType={bodyType}
                body={bodyText}
                formFields={formFields}
                multipartParts={multipartParts}
                graphql={graphql}
                onBodyTypeChange={setBodyType}
                onBodyChange={setBodyText}
                onFormFieldsChange={setFormFields}
                onMultipartChange={setMultipartParts}
                onGraphqlChange={setGraphql}
              />
            )}

            {httpTab === "assertions" && (
              <AssertionsEditor
                expressions={payload.expect ?? []}
                onChange={(es) => setPayload({ ...payload, expect: es })}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Non-HTTP protocol inputs ── */}
      {protocol !== "http" && (
        <div className="grid grid-cols-1 gap-3 border-b border-zinc-800 p-3 lg:grid-cols-2">
          {protocol === "redis" && (
            <RedisCommand
              command={(payload.meta?.command as string[]) ?? []}
              onChange={(c) => updateMeta("command", c)}
            />
          )}
          {protocol === "dns" && (
            <DnsOptions
              rtype={String(payload.meta?.rtype ?? "A")}
              onChange={(t) => updateMeta("rtype", t)}
            />
          )}
          {protocol === "smtp" && (
            <SmtpOptions
              meta={payload.meta ?? {}}
              body={payload.body ?? ""}
              onMeta={updateMeta}
              onBody={(v) => setPayload({ ...payload, body: v })}
            />
          )}
          {protocol === "ssh" && (
            <SshOptions
              command={String(payload.meta?.command ?? "")}
              knownHosts={payload.meta?.known_hosts}
              onMeta={updateMeta}
            />
          )}
          {protocol === "mqtt" && (
            <MqttOptions
              meta={payload.meta ?? {}}
              body={payload.body ?? ""}
              onMeta={updateMeta}
              onBody={(v) => setPayload({ ...payload, body: v })}
            />
          )}
          {PROTOCOLS_WITH_ASSERTIONS.has(protocol) && protocol !== "http" && (
            <AssertionsEditor
              expressions={payload.expect ?? []}
              onChange={(es) => setPayload({ ...payload, expect: es })}
            />
          )}
        </div>
      )}

      {/* ── Response / Log tabs ── */}
      <div className="flex border-b border-zinc-800 text-xs">
        {(["response", "log"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 ${
              tab === t
                ? "border-b-2 border-cyan-400 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "response" ? "Response" : `Log (${events.length})`}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "response" ? (
          <ResponsePane response={response} assertions={assertions} />
        ) : (
          <ConversationLog events={events} />
        )}
      </div>

      <SaveRequestModal
        open={saveModalOpen}
        existingId={editingItemId}
        initialName={editingName}
        initialFolder={editingFolder}
        onSave={async (name, folder) => {
          setEditingName(name);
          setEditingFolder(folder);
          await handleSaveCollection(name, folder);
        }}
        onClose={() => setSaveModalOpen(false)}
      />

      <ImportOpenApiModal
        open={openApiOpen}
        onClose={() => {
          setOpenApiOpen(false);
          // Auto-reveal the panel so the user sees their fresh import
          setCollectionsOpen(true);
        }}
      />

      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function HeadersEditor({
  headers,
  onChange,
}: {
  headers:  Record<string, string>;
  onChange: (h: Record<string, string>) => void;
}) {
  const [text, setText] = useState(
    Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")
  );

  const commit = (t: string) => {
    setText(t);
    const out: Record<string, string> = {};
    for (const line of t.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    onChange(out);
  };

  return (
    <div>
      <p className="mb-1 text-[10px] text-zinc-600">
        One header per line — <span className="text-zinc-400">Key: Value</span>.
        Auth headers are merged automatically from the Auth tab.
      </p>
      <textarea
        value={text}
        onChange={(e) => commit(e.target.value)}
        placeholder={"Accept: application/json\nX-Trace-Id: abc123"}
        className="h-32 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs text-zinc-300 outline-none focus:border-zinc-600"
      />
    </div>
  );
}

function RedisCommand({
  command,
  onChange,
}: {
  command:  string[];
  onChange: (c: string[]) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Command</div>
      <input
        value={command.join(" ")}
        onChange={(e) => onChange(e.target.value.split(/\s+/).filter(Boolean))}
        placeholder="GET foo"
        className="w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
      />
    </div>
  );
}

function DnsOptions({ rtype, onChange }: { rtype: string; onChange: (t: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Record type</div>
      <select
        value={rtype}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
      >
        {["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA"].map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    </div>
  );
}

function SmtpOptions({
  meta, body, onMeta, onBody,
}: {
  meta: Record<string, unknown>;
  body: string;
  onMeta: (key: string, value: unknown) => void;
  onBody: (v: string) => void;
}) {
  return (
    <div className="lg:col-span-2 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">SMTP</div>
      <div className="grid grid-cols-3 gap-2">
        <input value={String(meta.from ?? "")} onChange={(e) => onMeta("from", e.target.value)} placeholder="from: xray@localhost" className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs" />
        <input value={String(meta.to ?? "")}   onChange={(e) => onMeta("to",   e.target.value)} placeholder="to: alice@example.com" className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs" />
        <input value={String(meta.subject ?? "")} onChange={(e) => onMeta("subject", e.target.value)} placeholder="subject" className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs" />
      </div>
      <textarea value={body} onChange={(e) => onBody(e.target.value)} placeholder="email body" className="h-24 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs" />
    </div>
  );
}

function SshOptions({
  command, knownHosts, onMeta,
}: {
  command: string;
  knownHosts: unknown;
  onMeta: (key: string, value: unknown) => void;
}) {
  return (
    <div className="lg:col-span-2 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">SSH</div>
      <input value={command} onChange={(e) => onMeta("command", e.target.value)} placeholder="echo hello" className="w-full rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs" />
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={knownHosts === null} onChange={(e) => onMeta("known_hosts", e.target.checked ? null : "")} />
        Skip host-key verification (known_hosts = null)
      </label>
    </div>
  );
}

function MqttOptions({
  meta, body, onMeta, onBody,
}: {
  meta: Record<string, unknown>;
  body: string;
  onMeta: (key: string, value: unknown) => void;
  onBody: (v: string) => void;
}) {
  const action = String(meta.action ?? "publish");
  return (
    <div className="lg:col-span-2 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">MQTT</div>
      <div className="grid grid-cols-4 gap-2">
        <select value={action} onChange={(e) => onMeta("action", e.target.value)} className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs">
          <option value="publish">publish</option>
          <option value="subscribe">subscribe</option>
        </select>
        <input value={String(meta.topic ?? "")} onChange={(e) => onMeta("topic", e.target.value)} placeholder="topic" className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs" />
        <select value={String(meta.qos ?? 0)} onChange={(e) => onMeta("qos", Number(e.target.value))} className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs">
          {[0, 1, 2].map((q) => <option key={q} value={q}>QoS {q}</option>)}
        </select>
        {action === "subscribe"
          ? <input type="number" value={Number(meta.wait_ms ?? 2000)} onChange={(e) => onMeta("wait_ms", Number(e.target.value))} placeholder="wait ms" className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs" />
          : <span className="self-center text-[10px] text-zinc-600">payload below</span>
        }
      </div>
      {action === "publish" && (
        <textarea value={body} onChange={(e) => onBody(e.target.value)} placeholder="payload" className="h-20 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs" />
      )}
    </div>
  );
}

function AssertionsEditor({
  expressions,
  onChange,
}: {
  expressions: string[];
  onChange:    (es: string[]) => void;
}) {
  const [text, setText] = useState(expressions.join("\n"));
  const commit = (t: string) => {
    setText(t);
    onChange(t.split("\n").map((s) => s.trim()).filter(Boolean));
  };
  return (
    <div className="lg:col-span-2">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Assertions <span className="font-normal normal-case text-zinc-600">(one per line — e.g. status == 200)</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => commit(e.target.value)}
        placeholder="status == 200"
        className="h-20 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
      />
    </div>
  );
}
