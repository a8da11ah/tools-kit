from __future__ import annotations

import asyncio
import json
import socket
import ssl
import time
from datetime import datetime, timezone

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class TlsProtocol(Protocol):
    """Inspect TLS/SSL certificate chains and cipher negotiation.

    target = hostname:port  |  tls://hostname:port

    meta fields:
      sni      str   – Server Name Indication override (default: hostname).
                       Set explicitly when the hostname differs from the cert CN.
      timeout  float – TCP connect timeout in seconds (default: 10).

    Response body is a JSON object with:
      tls_version, cipher, cipher_bits, certificate { subject, issuer, sans,
      not_before, not_after, days_remaining, serial, fingerprint_sha256,
      key_type, key_size }, warnings []
    """

    name = "tls"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        target = req.target
        if "://" in target:
            from urllib.parse import urlparse
            parsed = urlparse(target)
            host = parsed.hostname or "localhost"
            port = parsed.port or 443
        else:
            parts = target.rsplit(":", 1)
            host = parts[0]
            port = int(parts[1]) if len(parts) == 2 else 443

        sni = str(req.meta.get("sni", host))
        timeout = float(req.meta.get("timeout", 10.0))

        logger.info(f"connecting to {host}:{port} (SNI={sni})")
        start = time.perf_counter()

        # Use CERT_NONE so we can inspect invalid/expired certs too
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        def _blocking_connect():
            with socket.create_connection((host, port), timeout=timeout) as raw:
                with ctx.wrap_socket(raw, server_hostname=sni) as tls_sock:
                    cert_der = tls_sock.getpeercert(binary_form=True)
                    cipher_info = tls_sock.cipher()   # (name, protocol, bits)
                    version = tls_sock.version()
                    return cert_der, cipher_info, version

        try:
            loop = asyncio.get_running_loop()
            cert_der, cipher_info, tls_version = await loop.run_in_executor(None, _blocking_connect)
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"connection failed: {exc}")
            return Response(status="ERR", body=str(exc).encode(), timing_ms=elapsed,
                            meta={"error": str(exc)})

        try:
            from cryptography import x509
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import ec, rsa

            cert = x509.load_der_x509_certificate(cert_der)

            # Timezone-aware dates (cryptography >= 42)
            try:
                not_before = cert.not_valid_before_utc
                not_after = cert.not_valid_after_utc
                now = datetime.now(timezone.utc)
            except AttributeError:
                not_before = cert.not_valid_before.replace(tzinfo=timezone.utc)
                not_after = cert.not_valid_after.replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)

            days_remaining = (not_after - now).days

            # Subject Alternative Names
            try:
                san_ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
                sans = [str(n) for n in san_ext.value]
            except x509.ExtensionNotFound:
                sans = []

            # Key info
            pub = cert.public_key()
            if isinstance(pub, rsa.RSAPublicKey):
                key_type, key_size = "RSA", pub.key_size
            elif isinstance(pub, ec.EllipticCurvePublicKey):
                key_type, key_size = "ECDSA", pub.key_size
            else:
                key_type, key_size = type(pub).__name__, None

            fingerprint = cert.fingerprint(hashes.SHA256()).hex(":")

            # Security warnings
            warnings: list[str] = []
            if days_remaining < 0:
                warnings.append("CERTIFICATE EXPIRED")
            elif days_remaining < 14:
                warnings.append(f"Expires in {days_remaining} days — renew immediately")
            elif days_remaining < 30:
                warnings.append(f"Expires in {days_remaining} days — renew soon")
            if tls_version in ("TLSv1", "TLSv1.1", "SSLv3"):
                warnings.append(f"{tls_version} is deprecated and insecure — upgrade to TLS 1.2+")
            if key_type == "RSA" and key_size and key_size < 2048:
                warnings.append(f"RSA key is only {key_size} bits — minimum recommended is 2048")
            cipher_name = cipher_info[0] if cipher_info else ""
            if any(w in cipher_name for w in ("RC4", "DES", "MD5", "NULL", "EXPORT")):
                warnings.append(f"Weak cipher in use: {cipher_name}")

            info = {
                "host": host,
                "port": port,
                "tls_version": tls_version,
                "cipher": cipher_name,
                "cipher_bits": cipher_info[2] if cipher_info else None,
                "certificate": {
                    "subject": cert.subject.rfc4514_string(),
                    "issuer": cert.issuer.rfc4514_string(),
                    "sans": sans,
                    "not_before": not_before.isoformat(),
                    "not_after": not_after.isoformat(),
                    "days_remaining": days_remaining,
                    "serial": str(cert.serial_number),
                    "fingerprint_sha256": fingerprint,
                    "key_type": key_type,
                    "key_size": key_size,
                },
                "warnings": warnings,
            }

            for w in warnings:
                logger.info(f"⚠ {w}")
            logger.recv(f"TLS {tls_version} | {cipher_name} ({cipher_info[2] if cipher_info else '?'} bits)")
            logger.recv(f"Subject : {cert.subject.rfc4514_string()}")
            logger.recv(f"SANs    : {', '.join(sans[:6])}{'…' if len(sans) > 6 else ''}")
            logger.recv(f"Expires : {not_after.date()}  ({days_remaining}d remaining)")
            logger.recv(f"Key     : {key_type}-{key_size}")
            logger.recv(f"SHA-256 : {fingerprint}")

            if days_remaining < 0:
                status = "EXPIRED"
            elif days_remaining < 30:
                status = "EXPIRING_SOON"
            elif warnings:
                status = "WARN"
            else:
                status = "OK"

            elapsed = (time.perf_counter() - start) * 1000
            return Response(status=status, timing_ms=elapsed,
                            body=json.dumps(info, indent=2).encode(), meta=info)

        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"cert parse error: {exc}")
            return Response(status="ERR", body=str(exc).encode(), timing_ms=elapsed,
                            meta={"error": str(exc)})

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="tls", target=target, meta={"timeout": 5.0}),
            ConversationLogger(),
        )
