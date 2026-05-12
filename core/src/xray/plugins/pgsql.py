from __future__ import annotations

import json
import time
from urllib.parse import urlparse

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class PgsqlProtocol(Protocol):
    """Execute a query against a PostgreSQL database.

    target = postgresql://user:password@host:5432/database
             postgres://user:password@host:5432/database

    meta fields:
      ssl_mode  str   – disable | allow | prefer | require | verify-ca | verify-full
                        (default: prefer). Use verify-full in production.
      timeout   float – connection + query timeout in seconds (default: 10.0).

    Response body is a JSON array of row objects.
    Response meta includes row_count, columns, and query_time_ms.
    """

    name = "pgsql"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        import asyncpg

        target = req.target
        if not target.startswith(("postgresql://", "postgres://")):
            target = f"postgresql://{target}"

        ssl_mode = str(req.meta.get("ssl_mode", "prefer"))
        timeout = float(req.meta.get("timeout", 10.0))
        query = (req.body or b"").decode("utf-8").strip()

        parsed = urlparse(target)
        logger.info(
            f"connecting to {parsed.hostname}:{parsed.port or 5432}"
            f" db={parsed.path.lstrip('/') or 'postgres'} ssl={ssl_mode}"
        )

        # asyncpg ssl param: False / True / ssl.SSLContext / "disable"/"require" etc.
        ssl_param: bool | str
        if ssl_mode == "disable":
            ssl_param = False
        elif ssl_mode in ("require", "verify-ca", "verify-full"):
            ssl_param = True
        else:
            ssl_param = False  # asyncpg doesn't support "prefer" directly; default off

        start = time.perf_counter()
        try:
            conn = await asyncpg.connect(target, ssl=ssl_param, timeout=timeout)
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"connection failed: {exc}")
            return Response(status="ERR", body=str(exc).encode(), timing_ms=elapsed,
                            meta={"error": str(exc)})

        try:
            if not query:
                logger.recv("connected (no query provided)")
                elapsed = (time.perf_counter() - start) * 1000
                version = await conn.fetchval("SELECT version()")
                logger.recv(str(version))
                return Response(status="OK", timing_ms=elapsed,
                                body=json.dumps([{"version": version}]).encode(),
                                meta={"row_count": 1, "columns": ["version"]})

            preview = query[:120].replace("\n", " ")
            logger.send(preview)

            query_start = time.perf_counter()
            rows = await conn.fetch(query)
            query_ms = (time.perf_counter() - query_start) * 1000

            columns = list(rows[0].keys()) if rows else []
            data = [dict(row) for row in rows]

            # Make values JSON-serializable
            def _serial(v):
                if hasattr(v, "isoformat"):
                    return v.isoformat()
                return str(v)

            serializable = [{k: (_serial(v) if not isinstance(v, (str, int, float, bool, type(None))) else v)
                             for k, v in row.items()} for row in data]

            logger.recv(f"{len(rows)} row(s) returned in {query_ms:.1f}ms")
            if columns:
                logger.recv(f"columns: {', '.join(columns)}")

            elapsed = (time.perf_counter() - start) * 1000
            return Response(
                status="OK",
                body=json.dumps(serializable, indent=2).encode(),
                timing_ms=elapsed,
                meta={"row_count": len(rows), "columns": columns, "query_time_ms": query_ms},
            )

        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"query error: {exc}")
            return Response(status="ERR", body=str(exc).encode(), timing_ms=elapsed,
                            meta={"error": str(exc)})
        finally:
            await conn.close()

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="pgsql", target=target, meta={"timeout": 5.0}),
            ConversationLogger(),
        )
