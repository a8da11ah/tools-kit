from __future__ import annotations

import asyncio
import json as _json
import sys
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from . import __version__, profiles as profiles_mod, replay as replay_mod
from .assertions import AssertionResult, all_passed, evaluate
from .auth import build as build_auth
from .diff import diff_responses
from .logger import ConversationLogger
from .models import Request
from .output import render_json, render_pretty
from .plugins import REGISTRY
from .sinks import RichConsoleSink
from .templating import render, render_dict

app = typer.Typer(
    name="xray",
    help="Xray - backend protocol inspector.",
    no_args_is_help=True,
    add_completion=False,
)

plugins_app = typer.Typer(help="Inspect registered protocol plugins.", no_args_is_help=True)
http_app = typer.Typer(help="HTTP/1.1 + HTTP/2 client.", no_args_is_help=True)
redis_app = typer.Typer(help="Redis client.", no_args_is_help=True)
dns_app = typer.Typer(help="DNS resolver.", no_args_is_help=True)
smtp_app = typer.Typer(help="SMTP client.", no_args_is_help=True)
ssh_app = typer.Typer(help="SSH remote exec.", no_args_is_help=True)
mqtt_app = typer.Typer(help="MQTT publish/subscribe.", no_args_is_help=True)
tls_app = typer.Typer(help="TLS/SSL certificate inspector.", no_args_is_help=True)
tcp_app = typer.Typer(help="Raw TCP socket client.", no_args_is_help=True)
udp_app = typer.Typer(help="Raw UDP socket client.", no_args_is_help=True)
ws_app = typer.Typer(help="WebSocket client.", no_args_is_help=True)
pgsql_app = typer.Typer(help="PostgreSQL client.", no_args_is_help=True)
mysql_app = typer.Typer(help="MySQL/MariaDB client.", no_args_is_help=True)
fuzz_app = typer.Typer(help="HTTP endpoint fuzzer.", no_args_is_help=True)
profiles_app = typer.Typer(help="Manage profiles.", no_args_is_help=True)
app.add_typer(plugins_app, name="plugins")
app.add_typer(http_app, name="http")
app.add_typer(redis_app, name="redis")
app.add_typer(dns_app, name="dns")
app.add_typer(smtp_app, name="smtp")
app.add_typer(ssh_app, name="ssh")
app.add_typer(mqtt_app, name="mqtt")
app.add_typer(tls_app, name="tls")
app.add_typer(tcp_app, name="tcp")
app.add_typer(udp_app, name="udp")
app.add_typer(ws_app, name="ws")
app.add_typer(pgsql_app, name="pgsql")
app.add_typer(mysql_app, name="mysql")
app.add_typer(fuzz_app, name="fuzz")
app.add_typer(profiles_app, name="profiles")

_console = Console()
_err = Console(stderr=True)


@app.command()
def version() -> None:
    """Print the xray version."""
    _console.print(f"xray {__version__}")


@plugins_app.command("list")
def plugins_list() -> None:
    """List all registered protocol plugins."""
    if not REGISTRY:
        _console.print("[yellow]No plugins registered yet.[/]")
        raise typer.Exit()
    table = Table(title="Registered protocols")
    table.add_column("name", style="cyan")
    table.add_column("class")
    table.add_column("module")
    for name, cls in sorted(REGISTRY.items()):
        table.add_row(name, cls.__name__, cls.__module__)
    _console.print(table)


@profiles_app.command("list")
def profiles_list() -> None:
    """List configured profiles."""
    pf = profiles_mod.load()
    if not pf.profiles:
        _console.print(f"[yellow]No profiles. Create one at[/] {profiles_mod.default_path()}")
        raise typer.Exit()
    table = Table(title=f"Profiles ({profiles_mod.default_path()})")
    table.add_column("name", style="cyan")
    table.add_column("vars")
    table.add_column("auth")
    for name, prof in sorted(pf.profiles.items()):
        table.add_row(name, ", ".join(prof.vars.keys()), prof.auth.kind if prof.auth else "-")
    _console.print(table)


@profiles_app.command("show")
def profiles_show(name: str) -> None:
    """Print one profile as JSON."""
    prof = profiles_mod.get(name)
    if prof is None:
        _err.print(f"[red]profile not found: {name}[/]")
        raise typer.Exit(2)
    _console.print_json(prof.model_dump_json())


HeaderOpt = Annotated[list[str] | None, typer.Option("--header", "-H", help="'Key: Value' (repeatable).")]
ParamOpt = Annotated[list[str] | None, typer.Option("--param", "-p", help="'key=value' (repeatable).")]
ExpectOpt = Annotated[list[str] | None, typer.Option("--expect", help="Assertion expression (repeatable).")]
ProfileOpt = Annotated[str | None, typer.Option("--profile", help="Profile name to apply.")]
SaveOpt = Annotated[Path | None, typer.Option("--save", help="Save the request as a .xray.yml replay file.")]
VerboseOpt = Annotated[bool, typer.Option("--verbose", "-v", help="Show the protocol exchange.")]
JsonOpt = Annotated[bool, typer.Option("--json", help="Emit a JSON object on stdout.")]


@http_app.command("get")
def http_get(
    url: str,
    header: HeaderOpt = None,
    param: ParamOpt = None,
    expect: ExpectOpt = None,
    profile: ProfileOpt = None,
    save: SaveOpt = None,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
    no_http2: Annotated[bool, typer.Option("--no-http2")] = False,
    insecure: Annotated[bool, typer.Option("--insecure", "-k")] = False,
    timeout: Annotated[float, typer.Option("--timeout")] = 30.0,
) -> None:
    """Issue an HTTP GET."""
    _run_http("GET", url, header, param, None, expect, profile, save, verbose, json_output, no_http2, insecure, timeout)


@http_app.command("post")
def http_post(
    url: str,
    data: Annotated[str | None, typer.Option("--data", "-d")] = None,
    data_file: Annotated[Path | None, typer.Option("--data-file")] = None,
    json_data: Annotated[str | None, typer.Option("--json-data")] = None,
    header: HeaderOpt = None,
    param: ParamOpt = None,
    expect: ExpectOpt = None,
    profile: ProfileOpt = None,
    save: SaveOpt = None,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
    no_http2: Annotated[bool, typer.Option("--no-http2")] = False,
    insecure: Annotated[bool, typer.Option("--insecure", "-k")] = False,
    timeout: Annotated[float, typer.Option("--timeout")] = 30.0,
) -> None:
    """Issue an HTTP POST."""
    body, extra_headers = _resolve_body(data, data_file, json_data)
    headers = _parse_headers(header)
    headers.update(extra_headers)
    _run_http("POST", url, None, param, body, expect, profile, save, verbose, json_output, no_http2, insecure, timeout,
              header_dict=headers)


def _resolve_body(data, data_file, json_data) -> tuple[bytes | None, dict[str, str]]:
    provided = sum(x is not None for x in (data, data_file, json_data))
    if provided > 1:
        raise typer.BadParameter("--data, --data-file, --json-data are mutually exclusive")
    if data is not None:
        return data.encode("utf-8"), {}
    if data_file is not None:
        return data_file.read_bytes(), {}
    if json_data is not None:
        return json_data.encode("utf-8"), {"content-type": "application/json"}
    return None, {}


def _run_http(
    method: str,
    url: str,
    header: list[str] | None,
    param: list[str] | None,
    body: bytes | None,
    expect: list[str] | None,
    profile: str | None,
    save: Path | None,
    verbose: bool,
    json_output: bool,
    no_http2: bool,
    insecure: bool,
    timeout: float,
    *,
    header_dict: dict[str, str] | None = None,
) -> None:
    headers = header_dict if header_dict is not None else _parse_headers(header)
    params = _parse_params(param)
    variables, auth_scheme = _resolve_profile(profile)

    url = render(url, variables)
    headers = render_dict(headers, variables)
    params = render_dict(params, variables) if params else {}
    if body is not None:
        try:
            body = render(body.decode("utf-8"), variables).encode("utf-8")
        except UnicodeDecodeError:
            pass

    mtls_cert: list[str] | None = None
    if auth_scheme is not None:
        from .auth.mtls import MTLSAuth

        if isinstance(auth_scheme, MTLSAuth):
            mtls_cert = list(auth_scheme.cert_tuple)
        else:
            try:
                auth_headers = asyncio.run(auth_scheme.headers())
                for k, v in auth_headers.items():
                    headers.setdefault(k, v)
            except Exception as exc:
                _err.print(f"[red]auth failed:[/] {exc}")
                raise typer.Exit(2) from exc

    meta: dict = {
        "method": method,
        "params": params or None,
        "http2": not no_http2,
        "verify": not insecure,
        "timeout": timeout,
        "introspect_tls": verbose and url.lower().startswith("https://"),
    }
    if mtls_cert:
        meta["_mtls_cert"] = mtls_cert

    request = Request(
        protocol="http",
        target=url,
        headers=headers,
        body=body,
        meta=meta,
    )

    if save is not None:
        replay_mod.save(save, request, profile=profile, expect=expect or [])
        if not json_output:
            _console.print(f"[green]saved replay:[/] {save}")

    response, _logger = _execute(request, verbose, json_output)
    assertion_results = evaluate(expect or [], response) if expect else []
    _emit_output(response, assertion_results, json_output)
    _exit_with_status(assertion_results, transport_failed=False)


def _execute(request: Request, verbose: bool, json_output: bool):
    plugin_cls = REGISTRY.get(request.protocol)
    if plugin_cls is None:
        _err.print(f"[red]plugin not registered: {request.protocol}[/]")
        raise typer.Exit(2)
    plugin = plugin_cls()
    logger = ConversationLogger()
    if verbose and not json_output:
        logger.attach(RichConsoleSink(_console))
    try:
        response = asyncio.run(plugin.send(request, logger))
    except Exception as exc:
        if json_output:
            sys.stdout.write(_json.dumps({"error": str(exc), "type": type(exc).__name__}, indent=2) + "\n")
        else:
            _err.print(f"[red]request failed:[/] {exc}")
        raise typer.Exit(2) from exc
    return response, logger


def _emit_output(response, assertion_results: list[AssertionResult], json_output: bool) -> None:
    if json_output:
        payload = _json.loads(render_json(response))
        if assertion_results:
            payload["assertions"] = [
                {"expr": r.expr, "passed": r.passed, "error": r.error} for r in assertion_results
            ]
            payload["passed"] = all(r.passed for r in assertion_results)
        sys.stdout.write(_json.dumps(payload, indent=2) + "\n")
        return

    render_pretty(response, _console)
    if assertion_results:
        table = Table(title="Assertions")
        table.add_column("expr")
        table.add_column("result")
        for r in assertion_results:
            mark = "[green]PASS[/]" if r.passed else f"[red]FAIL[/]" + (f" ({r.error})" if r.error else "")
            table.add_row(r.expr, mark)
        _console.print(table)


def _exit_with_status(results: list[AssertionResult], transport_failed: bool) -> None:
    if transport_failed:
        raise typer.Exit(2)
    if results and not all_passed(results):
        raise typer.Exit(1)


def _resolve_profile(name: str | None):
    if not name:
        return {}, None
    prof = profiles_mod.get(name)
    if prof is None:
        _err.print(f"[red]profile not found: {name}[/]")
        raise typer.Exit(2)
    auth = build_auth(prof.auth.model_dump() if prof.auth else None)
    return dict(prof.vars), auth


def _parse_headers(items: list[str] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items or []:
        if ":" not in item:
            raise typer.BadParameter(f"expected 'Key: Value', got {item!r}")
        k, _, v = item.partition(":")
        out[k.strip()] = v.strip()
    return out


def _parse_params(items: list[str] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items or []:
        if "=" not in item:
            raise typer.BadParameter(f"expected 'key=value', got {item!r}")
        k, _, v = item.partition("=")
        out[k.strip()] = v.strip()
    return out


@redis_app.command("ping")
def redis_ping(
    target: Annotated[str, typer.Option("--target", help="redis://host:port/db")] = "redis://localhost:6379",
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Send a Redis PING."""
    _run_redis(target, ["PING"], verbose, json_output, expect=None, save=None, profile=None)


@redis_app.command("cmd")
def redis_cmd(
    parts: Annotated[list[str], typer.Argument(help="Redis command tokens, e.g. GET foo")],
    target: Annotated[str, typer.Option("--target")] = "redis://localhost:6379",
    expect: ExpectOpt = None,
    save: SaveOpt = None,
    profile: ProfileOpt = None,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Run an arbitrary Redis command."""
    _run_redis(target, list(parts), verbose, json_output, expect, save, profile)


def _run_redis(target: str, command: list[str], verbose: bool, json_output: bool,
               expect: list[str] | None, save: Path | None, profile: str | None) -> None:
    variables, _ = _resolve_profile(profile)
    target = render(target, variables)
    request = Request(
        protocol="redis", target=target,
        meta={"command": [render(str(c), variables) for c in command]},
    )
    if save:
        replay_mod.save(save, request, profile=profile, expect=expect or [])
    response, _ = _execute(request, verbose, json_output)
    assertion_results = evaluate(expect or [], response) if expect else []
    _emit_output(response, assertion_results, json_output)
    _exit_with_status(assertion_results, False)


@dns_app.command("resolve")
def dns_resolve(
    name: str,
    rtype: Annotated[str, typer.Option("--type", "-t", help="record type")] = "A",
    nameserver: Annotated[str | None, typer.Option("--nameserver", "-n")] = None,
    expect: ExpectOpt = None,
    profile: ProfileOpt = None,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Resolve a DNS record."""
    variables, _ = _resolve_profile(profile)
    request = Request(
        protocol="dns", target=render(name, variables),
        meta={"rtype": rtype, "nameserver": nameserver},
    )
    response, _ = _execute(request, verbose, json_output)
    assertion_results = evaluate(expect or [], response) if expect else []
    _emit_output(response, assertion_results, json_output)
    _exit_with_status(assertion_results, False)


@app.command()
def replay(
    path: Path,
    profile: ProfileOpt = None,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Replay a saved .xray.yml file."""
    rep = replay_mod.load(path)
    request, expect = replay_mod.to_request(rep)
    effective_profile = profile or rep.profile
    variables, auth_scheme = _resolve_profile(effective_profile)
    if variables:
        request.target = render(request.target, variables)
        request.headers = render_dict(request.headers, variables)
    if auth_scheme is not None:
        try:
            auth_headers = asyncio.run(auth_scheme.headers())
            for k, v in auth_headers.items():
                request.headers.setdefault(k, v)
        except Exception as exc:
            _err.print(f"[red]auth failed:[/] {exc}")
            raise typer.Exit(2) from exc

    response, _ = _execute(request, verbose, json_output)
    assertion_results = evaluate(expect, response) if expect else []
    _emit_output(response, assertion_results, json_output)
    _exit_with_status(assertion_results, False)


@app.command("diff")
def diff_command(
    profiles_csv: Annotated[str, typer.Option("--profiles", help="comma-separated profile names")],
    method: Annotated[str, typer.Option("--method", "-X")] = "GET",
    url: Annotated[str | None, typer.Option("--url")] = None,
    header: HeaderOpt = None,
    json_output: JsonOpt = False,
) -> None:
    """Fire the same HTTP request against multiple profiles, then diff the responses."""
    if not url:
        _err.print("[red]--url is required[/]")
        raise typer.Exit(2)
    names = [n.strip() for n in profiles_csv.split(",") if n.strip()]
    if len(names) < 2:
        _err.print("[red]--profiles must contain at least two names[/]")
        raise typer.Exit(2)

    headers_in = _parse_headers(header)
    responses = []
    for name in names:
        variables, auth_scheme = _resolve_profile(name)
        rendered_url = render(url, variables)
        rendered_headers = render_dict(dict(headers_in), variables)
        if auth_scheme is not None:
            for k, v in asyncio.run(auth_scheme.headers()).items():
                rendered_headers.setdefault(k, v)
        req = Request(
            protocol="http", target=rendered_url, headers=rendered_headers,
            meta={"method": method.upper(), "timeout": 30.0, "http2": True, "verify": True},
        )
        plugin = REGISTRY["http"]()
        responses.append((name, asyncio.run(plugin.send(req, ConversationLogger()))))

    diff = diff_responses(responses[0][1], responses[1][1])
    if json_output:
        payload = {
            "profiles": [
                {"profile": n, "status": r.status, "timing_ms": r.timing_ms} for n, r in responses
            ],
            "diff": {
                "status": diff["status"],
                "headers": [_diff_entry_dict(e) for e in diff["headers"]],
                "body": [_diff_entry_dict(e) for e in diff["body"]],
            },
        }
        sys.stdout.write(_json.dumps(payload, indent=2, default=str) + "\n")
        return

    table = Table(title="Status / timing")
    table.add_column("profile", style="cyan")
    table.add_column("status")
    table.add_column("timing_ms")
    for name, resp in responses:
        table.add_row(name, str(resp.status), f"{resp.timing_ms:.1f}")
    _console.print(table)

    body_table = Table(title="Body diff")
    body_table.add_column("path", style="cyan")
    body_table.add_column("kind")
    body_table.add_column(f"{names[0]} (left)")
    body_table.add_column(f"{names[1]} (right)")
    for entry in diff["body"]:
        body_table.add_row(entry.path, entry.kind, str(entry.left), str(entry.right))
    if diff["body"]:
        _console.print(body_table)
    else:
        _console.print("[green]bodies are equal[/]")


def _diff_entry_dict(entry):
    return {"path": entry.path, "kind": entry.kind, "left": entry.left, "right": entry.right}


@smtp_app.command("probe")
def smtp_probe(
    target: str,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Connect to an SMTP server and exchange EHLO (no email sent)."""
    request = Request(protocol="smtp", target=target, meta={"timeout": 10.0})
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


@smtp_app.command("send")
def smtp_send(
    target: str,
    to: Annotated[str, typer.Option("--to", help="recipient address")],
    from_: Annotated[str, typer.Option("--from", help="sender address")] = "xray@localhost",
    subject: Annotated[str, typer.Option("--subject")] = "(no subject)",
    body: Annotated[str | None, typer.Option("--body")] = None,
    username: Annotated[str | None, typer.Option("--username")] = None,
    password: Annotated[str | None, typer.Option("--password")] = None,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Send an email via SMTP."""
    meta: dict = {"to": to, "from": from_, "subject": subject, "timeout": 10.0}
    if username:
        meta["username"] = username
    if password:
        meta["password"] = password
    request = Request(
        protocol="smtp", target=target,
        body=(body or "").encode("utf-8"),
        meta=meta,
    )
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


@ssh_app.command("run")
def ssh_run(
    target: str,
    command: Annotated[str, typer.Option("--command", "-c", help="remote command to execute")],
    username: Annotated[str | None, typer.Option("--username", "-u")] = None,
    password: Annotated[str | None, typer.Option("--password")] = None,
    known_hosts: Annotated[str | None, typer.Option("--known-hosts")] = None,
    expect: ExpectOpt = None,
    profile: ProfileOpt = None,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
    timeout: Annotated[float, typer.Option("--timeout")] = 15.0,
) -> None:
    """Execute a command on a remote host over SSH."""
    variables, _ = _resolve_profile(profile)
    meta: dict = {"command": render(command, variables), "timeout": timeout}
    if username:
        meta["username"] = username
    if password:
        meta["password"] = password
    if known_hosts:
        meta["known_hosts"] = known_hosts
    request = Request(protocol="ssh", target=render(target, variables), meta=meta)
    response, _ = _execute(request, verbose, json_output)
    assertion_results = evaluate(expect or [], response) if expect else []
    _emit_output(response, assertion_results, json_output)
    _exit_with_status(assertion_results, False)


@mqtt_app.command("publish")
def mqtt_publish(
    target: str,
    topic: Annotated[str, typer.Option("--topic", "-t")],
    message: Annotated[str | None, typer.Option("--message", "-m")] = None,
    qos: Annotated[int, typer.Option("--qos")] = 0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Publish a message to an MQTT topic."""
    request = Request(
        protocol="mqtt", target=target,
        body=(message or "").encode("utf-8"),
        meta={"action": "publish", "topic": topic, "qos": qos},
    )
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


@mqtt_app.command("subscribe")
def mqtt_subscribe(
    target: str,
    topic: Annotated[str, typer.Option("--topic", "-t")],
    wait: Annotated[float, typer.Option("--wait", help="seconds to listen")] = 5.0,
    qos: Annotated[int, typer.Option("--qos")] = 0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Subscribe to an MQTT topic and print messages for --wait seconds."""
    request = Request(
        protocol="mqtt", target=target,
        meta={"action": "subscribe", "topic": topic, "qos": qos, "wait_ms": wait * 1000},
    )
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


# ── TLS ──────────────────────────────────────────────────────────────────────

@tls_app.command("inspect")
def tls_inspect(
    target: str,
    sni: Annotated[str | None, typer.Option("--sni", help="SNI override")] = None,
    timeout: Annotated[float, typer.Option("--timeout")] = 10.0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Inspect TLS certificate and cipher suite of a host:port."""
    meta: dict = {"timeout": timeout}
    if sni:
        meta["sni"] = sni
    request = Request(protocol="tls", target=target, meta=meta)
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


# ── TCP / UDP ─────────────────────────────────────────────────────────────────

@tcp_app.command("send")
def tcp_send(
    target: str,
    data: Annotated[str | None, typer.Option("--data", "-d", help="Text payload to send")] = None,
    hex_data: Annotated[str | None, typer.Option("--hex", help="Hex payload, e.g. 'FF 00 A1'")] = None,
    read_timeout: Annotated[float, typer.Option("--read-timeout")] = 3.0,
    timeout: Annotated[float, typer.Option("--timeout")] = 10.0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Connect to a TCP endpoint, send a payload, and print the response."""
    if data and hex_data:
        raise typer.BadParameter("--data and --hex are mutually exclusive")
    encoding = "hex" if hex_data else "text"
    body = (hex_data or data or "").encode("utf-8")
    request = Request(protocol="tcp", target=target, body=body,
                      meta={"payload_encoding": encoding, "read_timeout": read_timeout, "timeout": timeout})
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


@udp_app.command("send")
def udp_send(
    target: str,
    data: Annotated[str | None, typer.Option("--data", "-d")] = None,
    hex_data: Annotated[str | None, typer.Option("--hex")] = None,
    read_timeout: Annotated[float, typer.Option("--read-timeout")] = 3.0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Send a UDP datagram and print the response datagram (if any)."""
    if data and hex_data:
        raise typer.BadParameter("--data and --hex are mutually exclusive")
    encoding = "hex" if hex_data else "text"
    body = (hex_data or data or "").encode("utf-8")
    request = Request(protocol="udp", target=target, body=body,
                      meta={"payload_encoding": encoding, "read_timeout": read_timeout})
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_app.command("connect")
def ws_connect(
    url: str,
    send: Annotated[str | None, typer.Option("--send", "-s", help="Message to send after connecting")] = None,
    subprotocol: Annotated[str | None, typer.Option("--subprotocol")] = None,
    wait: Annotated[float, typer.Option("--wait", help="Seconds to collect messages")] = 3.0,
    ping: Annotated[bool, typer.Option("--ping")] = False,
    timeout: Annotated[float, typer.Option("--timeout")] = 10.0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Connect to a WebSocket endpoint, optionally send a message, and print received frames."""
    meta: dict = {"wait_ms": wait * 1000, "timeout": timeout, "ping": ping}
    if subprotocol:
        meta["subprotocol"] = subprotocol
    request = Request(protocol="ws", target=url, body=(send or "").encode("utf-8"), meta=meta)
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


# ── PostgreSQL ────────────────────────────────────────────────────────────────

@pgsql_app.command("query")
def pgsql_query(
    query: str,
    target: Annotated[str, typer.Option("--target", "-t")] = "postgresql://localhost:5432/postgres",
    ssl_mode: Annotated[str, typer.Option("--ssl-mode")] = "prefer",
    timeout: Annotated[float, typer.Option("--timeout")] = 10.0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Run a SQL query against a PostgreSQL database."""
    request = Request(protocol="pgsql", target=target,
                      body=query.encode("utf-8"),
                      meta={"ssl_mode": ssl_mode, "timeout": timeout})
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


# ── MySQL ─────────────────────────────────────────────────────────────────────

@mysql_app.command("query")
def mysql_query(
    query: str,
    target: Annotated[str, typer.Option("--target", "-t")] = "mysql://root@localhost:3306/",
    ssl: Annotated[bool, typer.Option("--ssl")] = False,
    timeout: Annotated[float, typer.Option("--timeout")] = 10.0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Run a SQL query against a MySQL or MariaDB database."""
    request = Request(protocol="mysql", target=target,
                      body=query.encode("utf-8"),
                      meta={"ssl": ssl, "timeout": timeout})
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


# ── Fuzzer ────────────────────────────────────────────────────────────────────

@fuzz_app.command("http")
def fuzz_http(
    url: Annotated[str, typer.Option("--url", help="URL with FUZZ placeholder")],
    wordlist: Annotated[Path, typer.Option("--wordlist", "-w", help="Wordlist file (one word per line)")],
    method: Annotated[str, typer.Option("--method", "-X")] = "GET",
    concurrency: Annotated[int, typer.Option("--threads", "-t")] = 40,
    rate_limit: Annotated[float, typer.Option("--rate", help="Max req/s (0 = unlimited)")] = 0.0,
    match_codes: Annotated[str, typer.Option("--mc", help="Comma-separated status codes to show")] = "",
    filter_codes: Annotated[str, typer.Option("--fc", help="Comma-separated status codes to hide")] = "",
    req_timeout: Annotated[float, typer.Option("--timeout")] = 10.0,
    verbose: VerboseOpt = False,
    json_output: JsonOpt = False,
) -> None:
    """Fuzz HTTP endpoints by substituting FUZZ in the URL with wordlist entries."""
    words = wordlist.read_bytes()
    meta: dict = {
        "method": method,
        "concurrency": concurrency,
        "rate_limit": rate_limit,
        "req_timeout": req_timeout,
    }
    if match_codes:
        meta["match_codes"] = [int(c.strip()) for c in match_codes.split(",") if c.strip()]
    if filter_codes:
        meta["filter_codes"] = [int(c.strip()) for c in filter_codes.split(",") if c.strip()]
    request = Request(protocol="fuzz", target=url, body=words, meta=meta)
    response, _ = _execute(request, verbose, json_output)
    _emit_output(response, [], json_output)


if __name__ == "__main__":
    app()
