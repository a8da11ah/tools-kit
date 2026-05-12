import { authToken, baseUrl } from "./api";
import type { AssertionResult, ConversationEvent, RequestPayload, ResponsePayload } from "./types";

export interface StreamCallbacks {
  onEvent: (event: ConversationEvent) => void;
  onResponse: (response: ResponsePayload, assertions: AssertionResult[], passed: boolean) => void;
  onError: (error: string) => void;
  onClose: () => void;
}

export function streamRequest(payload: RequestPayload, cb: StreamCallbacks): WebSocket {
  const url = baseUrl().replace(/^http/, "ws") + "/requests/stream";
  const ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(JSON.stringify({ token: authToken() }));
    ws.send(JSON.stringify(payload));
  };

  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data.type === "event") cb.onEvent(data.event as ConversationEvent);
      else if (data.type === "response")
        cb.onResponse(
          data.response as ResponsePayload,
          (data.assertions ?? []) as AssertionResult[],
          data.passed ?? true,
        );
      else if (data.type === "error") cb.onError(String(data.error));
    } catch (e) {
      cb.onError(String(e));
    }
  };

  ws.onerror = () => cb.onError("websocket error");
  ws.onclose = () => cb.onClose();

  return ws;
}
