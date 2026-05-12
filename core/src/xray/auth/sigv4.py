from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timezone
from urllib.parse import quote, urlparse, parse_qs

from .base import AuthScheme


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date: str, region: str, service: str) -> bytes:
    k_date = _sign(("AWS4" + secret).encode("utf-8"), date)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    return _sign(k_service, "aws4_request")


class SigV4Auth(AuthScheme):
    """AWS Signature Version 4. Produces pre-computed headers for a GET request to the target URL.

    For full request signing (any method + body), use `sign_request()` directly.
    Auth headers generated at `.headers()` time assume method=GET and no body.
    """

    def __init__(
        self,
        access_key: str,
        secret_key: str,
        region: str,
        service: str,
        session_token: str | None = None,
    ) -> None:
        self.access_key = access_key
        self.secret_key = secret_key
        self.region = region
        self.service = service
        self.session_token = session_token

    async def headers(self) -> dict[str, str]:
        # Minimal: return auth headers for an empty-body GET.
        # Real request signing should call sign_request() from the plugin.
        return self._sign_headers(
            method="GET",
            url="",
            headers={},
            body=b"",
        )

    def sign_request(
        self, *, method: str, url: str, headers: dict[str, str], body: bytes = b""
    ) -> dict[str, str]:
        return self._sign_headers(method=method, url=url, headers=headers, body=body)

    def _sign_headers(
        self, *, method: str, url: str, headers: dict[str, str], body: bytes
    ) -> dict[str, str]:
        now = datetime.now(tz=timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")

        parsed = urlparse(url)
        host = parsed.netloc or ""
        uri = quote(parsed.path or "/", safe="/-_.~")

        raw_qs = parse_qs(parsed.query, keep_blank_values=True)
        canonical_qs = "&".join(
            f"{quote(k, safe='-_.~')}={quote(v[0], safe='-_.~')}"
            for k, v in sorted(raw_qs.items())
        )

        payload_hash = hashlib.sha256(body).hexdigest()

        signed_headers_map: dict[str, str] = {
            "host": host,
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
            **{k.lower(): v for k, v in headers.items()},
        }
        if self.session_token:
            signed_headers_map["x-amz-security-token"] = self.session_token

        signed_header_names = ";".join(sorted(signed_headers_map))
        canonical_headers = "".join(
            f"{k}:{signed_headers_map[k]}\n" for k in sorted(signed_headers_map)
        )

        canonical_request = "\n".join([
            method.upper(),
            uri,
            canonical_qs,
            canonical_headers,
            signed_header_names,
            payload_hash,
        ])

        credential_scope = f"{date_stamp}/{self.region}/{self.service}/aws4_request"
        string_to_sign = "\n".join([
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ])

        signing_key = _signing_key(self.secret_key, date_stamp, self.region, self.service)
        signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

        authorization = (
            f"AWS4-HMAC-SHA256 Credential={self.access_key}/{credential_scope}, "
            f"SignedHeaders={signed_header_names}, Signature={signature}"
        )

        out: dict[str, str] = {
            "authorization": authorization,
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
        }
        if self.session_token:
            out["x-amz-security-token"] = self.session_token
        return out
