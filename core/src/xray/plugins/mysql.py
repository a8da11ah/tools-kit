from __future__ import annotations

import json
import time
from urllib.parse import urlparse

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class MysqlProtocol(Protocol):
    """Execute a query against a MySQL / MariaDB database.

    target = mysql://user:password@host:3306/database

    meta fields:
      ssl       bool  – require SSL/TLS for the connection (default: False).
                        Set to True in production to protect credentials in transit.
      charset   str   – character set (default: "utf8mb4", supports emoji + full Unicode).
      timeout   float – connection + query timeout in seconds (default: 10.0).

    Response body is a JSON array of row objects.
    Response meta includes row_count, columns, and query_time_ms.
    """

    name = "mysql"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        import aiomysql

        target = req.target
        if not target.startswith("mysql://"):
            target = f"mysql://{target}"

        parsed = urlparse(target)
        host = parsed.hostname or "localhost"
        port = parsed.port or 3306
        user = parsed.username or "root"
        password = parsed.password or ""
        database = parsed.path.lstrip("/") or None
        use_ssl = bool(req.meta.get("ssl", False))
        charset = str(req.meta.get("charset", "utf8mb4"))
        timeout = float(req.meta.get("timeout", 10.0))
        query = (req.body or b"").decode("utf-8").strip()

        logger.info(
            f"connecting to {host}:{port}"
            f" db={database or '(none)'} ssl={'on' if use_ssl else 'off'}"
        )

        ssl_ctx = None
        if use_ssl:
            import ssl as ssl_mod
            ssl_ctx = ssl_mod.create_default_context()

        start = time.perf_counter()
        try:
            conn = await aiomysql.connect(
                host=host, port=port, user=user, password=password,
                db=database, ssl=ssl_ctx, charset=charset,
                connect_timeout=timeout,
            )
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"connection failed: {exc}")
            return Response(status="ERR", body=str(exc).encode(), timing_ms=elapsed,
                            meta={"error": str(exc)})

        try:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                if not query:
                    await cur.execute("SELECT VERSION() AS version")
                    row = await cur.fetchone()
                    version = row["version"] if row else "unknown"
                    logger.recv(f"connected — MySQL {version}")
                    elapsed = (time.perf_counter() - start) * 1000
                    return Response(status="OK", timing_ms=elapsed,
                                    body=json.dumps([{"version": version}]).encode(),
                                    meta={"row_count": 1, "columns": ["version"]})

                preview = query[:120].replace("\n", " ")
                logger.send(preview)

                query_start = time.perf_counter()
                await cur.execute(query)
                rows = await cur.fetchall()
                query_ms = (time.perf_counter() - query_start) * 1000

                columns = [d[0] for d in cur.description] if cur.description else []
                data = list(rows)

                def _serial(v):
                    if hasattr(v, "isoformat"):
                        return v.isoformat()
                    if isinstance(v, (bytes, bytearray)):
                        return v.hex()
                    return str(v)

                serializable = [
                    {k: (_serial(v) if not isinstance(v, (str, int, float, bool, type(None))) else v)
                     for k, v in row.items()}
                    for row in data
                ]

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
            conn.close()

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="mysql", target=target, meta={"timeout": 5.0}),
            ConversationLogger(),
        )
