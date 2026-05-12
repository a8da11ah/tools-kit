from __future__ import annotations

import asyncio
import json
import time

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register

# Status codes that are interesting by default (similar to ffuf/gobuster defaults)
_DEFAULT_MATCH = {200, 204, 301, 302, 307, 308, 401, 403, 405}


@register
class FuzzProtocol(Protocol):
    """HTTP endpoint fuzzer — brute-forces paths/parameters using a wordlist.

    target = URL containing the placeholder FUZZ, e.g.:
             https://example.com/FUZZ
             https://api.example.com/v1/FUZZ/details
             https://example.com/?id=FUZZ

    body   = newline-separated wordlist (one entry per line)

    meta fields:
      method        str       – HTTP method (default: GET)
      concurrency   int       – parallel requests (default: 40, like ffuf)
      rate_limit    float     – max requests per second, 0 = unlimited (default: 0)
      match_codes   list[int] – status codes to report as hits
                                (default: 200 204 301 302 307 308 401 403 405)
      filter_codes  list[int] – status codes to suppress even if in match_codes
      req_timeout   float     – timeout per individual request in seconds (default: 10)
      headers       dict      – extra headers to send with every request

    Each hit is emitted as a recv ConversationEvent containing a JSON object:
      { word, url, status, size, timing_ms }
    The final Response body is a JSON array of all hits.
    """

    name = "fuzz"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        from .base import REGISTRY

        url_template = req.target
        if "FUZZ" not in url_template:
            logger.info("warning: target URL does not contain FUZZ placeholder")

        wordlist = [
            line.strip()
            for line in (req.body or b"").decode("utf-8", errors="replace").splitlines()
            if line.strip() and not line.startswith("#")
        ]

        method = str(req.meta.get("method", "GET")).upper()
        concurrency = int(req.meta.get("concurrency", 40))
        rate_limit = float(req.meta.get("rate_limit", 0))
        match_codes: set[int] = set(req.meta.get("match_codes", list(_DEFAULT_MATCH)))
        filter_codes: set[int] = set(req.meta.get("filter_codes", []))
        req_timeout = float(req.meta.get("req_timeout", 10.0))
        extra_headers: dict[str, str] = req.meta.get("headers", {})

        total = len(wordlist)
        if total == 0:
            return Response(status="ERR", body=b"wordlist is empty",
                            timing_ms=0, meta={"error": "empty wordlist"})

        logger.info(f"fuzzing {url_template}")
        logger.info(f"words={total}  threads={concurrency}  method={method}"
                    + (f"  rate={rate_limit}/s" if rate_limit else ""))

        http_cls = REGISTRY.get("http")
        if http_cls is None:
            return Response(status="ERR", body=b"http plugin not registered",
                            timing_ms=0, meta={"error": "http plugin missing"})

        hits: list[dict] = []
        sem = asyncio.Semaphore(concurrency)
        completed = 0
        start = time.perf_counter()

        # Token-bucket style rate limiting
        rate_lock = asyncio.Lock()
        last_send: list[float] = [0.0]

        async def _rate_throttle() -> None:
            if rate_limit <= 0:
                return
            async with rate_lock:
                gap = 1.0 / rate_limit
                now = asyncio.get_event_loop().time()
                wait = last_send[0] + gap - now
                if wait > 0:
                    await asyncio.sleep(wait)
                last_send[0] = asyncio.get_event_loop().time()

        async def _probe(word: str) -> None:
            nonlocal completed
            async with sem:
                await _rate_throttle()
                url = url_template.replace("FUZZ", word)
                silent_logger = ConversationLogger()
                http_plugin = http_cls()
                try:
                    resp = await http_plugin.send(
                        Request(
                            protocol="http",
                            target=url,
                            headers=extra_headers,
                            meta={
                                "method": method,
                                "timeout": req_timeout,
                                "verify": True,
                                "http2": False,
                            },
                        ),
                        silent_logger,
                    )
                    code = int(resp.status) if str(resp.status).isdigit() else 0
                    if code in match_codes and code not in filter_codes:
                        size = len(resp.body) if resp.body else 0
                        hit = {
                            "word": word,
                            "url": url,
                            "status": code,
                            "size": size,
                            "timing_ms": round(resp.timing_ms, 1),
                        }
                        hits.append(hit)
                        logger.recv(json.dumps(hit))
                except Exception:
                    pass
                finally:
                    completed += 1
                    if completed % 250 == 0 or completed == total:
                        elapsed_s = time.perf_counter() - start
                        rps = completed / elapsed_s if elapsed_s > 0 else 0
                        logger.info(f"progress {completed}/{total}  {rps:.0f} req/s  {len(hits)} hits")

        await asyncio.gather(*[_probe(w) for w in wordlist])

        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(f"done — {len(hits)} hits from {total} words in {elapsed_ms:.0f}ms")

        return Response(
            status=f"{len(hits)} hits / {total}",
            body=json.dumps(hits, indent=2).encode(),
            timing_ms=elapsed_ms,
            meta={"hits": len(hits), "total": total, "url_template": url_template},
        )

    async def health(self, target: str) -> Response:
        return Response(status="OK", timing_ms=0, meta={"note": "fuzz plugin ready"})
