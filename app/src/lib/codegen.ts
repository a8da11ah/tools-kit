import type { RequestPayload } from "../types";

export function generateCurl(payload: RequestPayload): string {
  const method = String(payload.meta?.method ?? "GET");
  const target = payload.target;
  const headers = payload.headers ?? {};
  const body = payload.body;

  let cmd = `curl -X ${method} "${target}"`;

  for (const [k, v] of Object.entries(headers)) {
    cmd += ` \\\n  -H "${k}: ${v}"`;
  }

  if (body && typeof body === "string" && body.trim().length > 0) {
    // Escape single quotes for bash
    const escapedBody = body.replace(/'/g, "'\\''");
    cmd += ` \\\n  -d '${escapedBody}'`;
  }

  return cmd;
}

export function generateFetch(payload: RequestPayload): string {
  const method = String(payload.meta?.method ?? "GET");
  const target = payload.target;
  const headers = payload.headers ?? {};
  const body = payload.body;

  const options: Record<string, any> = { method };

  if (Object.keys(headers).length > 0) {
    options.headers = headers;
  }

  if (body && typeof body === "string" && body.trim().length > 0) {
    // If it's JSON, don't double stringify in the output string
    let bodyStr = JSON.stringify(body);
    try {
      JSON.parse(body);
      // It's already valid JSON string, we just dump it as is for readability
      bodyStr = `JSON.stringify(${body})`;
    } catch {
      // Keep it as a raw string
    }
    options.body = "__BODY__MAGIC__"; 
  }

  const optionsStr = JSON.stringify(options, null, 2).replace('"__BODY__MAGIC__"', body ? (
    body.startsWith('{') || body.startsWith('[') ? `JSON.stringify(${body})` : `\`${body}\``
  ) : '');

  return `fetch("${target}", ${optionsStr});`;
}

export function generatePython(payload: RequestPayload): string {
  const method = String(payload.meta?.method ?? "GET").toLowerCase();
  const target = payload.target;
  const headers = payload.headers ?? {};
  const body = payload.body;

  let code = `import requests\n\nurl = "${target}"`;

  if (Object.keys(headers).length > 0) {
    code += `\n\nheaders = ${JSON.stringify(headers, null, 4)}`;
  }

  if (body && typeof body === "string" && body.trim().length > 0) {
    try {
      const parsed = JSON.parse(body);
      code += `\n\njson_data = ${JSON.stringify(parsed, null, 4)}`;
      code += `\n\nresponse = requests.${method}(url, headers=${Object.keys(headers).length > 0 ? 'headers' : '{}'}, json=json_data)`;
    } catch {
      code += `\n\ndata = """${body}"""`;
      code += `\n\nresponse = requests.${method}(url, headers=${Object.keys(headers).length > 0 ? 'headers' : '{}'}, data=data)`;
    }
  } else {
    code += `\n\nresponse = requests.${method}(url${Object.keys(headers).length > 0 ? ', headers=headers' : ''})`;
  }

  code += `\n\nprint(response.status_code)\nprint(response.text)`;
  return code;
}
