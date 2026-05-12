from __future__ import annotations

import time
from email.message import EmailMessage
from urllib.parse import urlparse

import aiosmtplib

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class SmtpProtocol(Protocol):
    """Send email or probe SMTP servers.

    target  = smtp://host:port  (plain or STARTTLS)
            | smtps://host:port (Implicit TLS / SMTPS, RFC 8314)

    meta fields:
      starttls      bool   – upgrade plain connection via STARTTLS (port 587 default)
      username/password    – SMTP AUTH credentials
      from/to/cc/bcc       – envelope addresses
      subject              – message subject
      content_type  str    – "plain" (default) or "html"
      timeout       float  – seconds (default 10)
    """

    name = "smtp"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        parsed = urlparse(req.target if "://" in req.target else f"smtp://{req.target}")
        host = parsed.hostname or "localhost"
        port = parsed.port or (465 if parsed.scheme == "smtps" else 587)
        use_tls = parsed.scheme == "smtps"
        # Explicit meta flag wins; fall back to port-based guess for CLI callers
        start_tls = bool(req.meta.get("starttls", port == 587)) and not use_tls
        timeout = float(req.meta.get("timeout", 10.0))
        username = str(req.meta["username"]) if "username" in req.meta else None
        password = str(req.meta["password"]) if "password" in req.meta else None

        client = aiosmtplib.SMTP(
            hostname=host,
            port=port,
            use_tls=use_tls,
            timeout=timeout,
        )

        events: list[tuple[str, str]] = []

        def _log_send(text: str) -> None:
            logger.send(text)
            events.append(("send", text))

        def _log_recv(text: str) -> None:
            logger.recv(text)
            events.append(("recv", text))

        start = time.perf_counter()
        try:
            enc_label = "Implicit TLS" if use_tls else ("STARTTLS" if start_tls else "plain")
            await client.connect()
            _log_recv(f"connected to {host}:{port} ({enc_label})")

            if start_tls:
                await client.starttls()
                _log_recv("STARTTLS handshake OK")

            if username and password:
                await client.login(username, password)
                _log_recv(f"AUTH OK ({username})")

            to_addr = req.meta.get("to")
            from_addr = req.meta.get("from", "xray@localhost")
            subject = req.meta.get("subject", "(no subject)")
            cc_addr = req.meta.get("cc", "")
            bcc_addr = req.meta.get("bcc", "")
            content_type = str(req.meta.get("content_type", "plain"))
            body_text = req.body.decode("utf-8") if req.body else ""

            if to_addr:
                msg = EmailMessage()
                msg["Subject"] = str(subject)
                msg["From"] = str(from_addr)
                msg["To"] = str(to_addr)
                if cc_addr:
                    msg["Cc"] = str(cc_addr)
                if content_type == "html":
                    msg.set_content("(HTML email — see attached)")
                    msg.add_alternative(body_text, subtype="html")
                else:
                    msg.set_content(body_text)
                # BCC recipients included in envelope but not headers
                recipients = [str(to_addr)]
                if cc_addr:
                    recipients.append(str(cc_addr))
                if bcc_addr:
                    recipients.extend(a.strip() for a in str(bcc_addr).split(",") if a.strip())
                _log_send(f"MAIL FROM:<{from_addr}> RCPT TO:<{to_addr}> DATA …")
                await client.send_message(msg, recipients=recipients)
                _log_recv("250 Message accepted")
            else:
                ehlo_resp = await client.ehlo()
                _log_recv(f"EHLO → {ehlo_resp}")

            elapsed_ms = (time.perf_counter() - start) * 1000.0
            return Response(
                status="OK",
                timing_ms=elapsed_ms,
                meta={"host": host, "port": port, "encryption": enc_label, "events": events},
            )
        except aiosmtplib.SMTPException as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            logger.info(f"SMTP error: {exc}")
            return Response(
                status="ERR",
                body=str(exc).encode("utf-8"),
                timing_ms=elapsed_ms,
                meta={"error": str(exc)},
            )
        finally:
            try:
                await client.quit()
            except Exception:
                pass

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="smtp", target=target, meta={"timeout": 5.0}),
            ConversationLogger(),
        )
