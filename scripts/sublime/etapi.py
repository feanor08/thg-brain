"""Small stdlib ETAPI transport. Never log requests, headers, URLs or response bodies."""
import ipaddress
import json
import os
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request


class Refused(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Refused("ETAPI redirect refused")


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    try:
        addr = ipaddress.ip_address(parsed.hostname or "")
        port = parsed.port
    except ValueError:
        raise Refused("Use an explicit loopback IP endpoint through an operator-managed private tunnel") from None
    if (not addr.is_loopback or parsed.scheme not in ("http", "https") or not port
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/")):
        raise Refused("Only a loopback origin with explicit port and no URL credentials/path is allowed")
    return url.rstrip("/") + "/etapi"


def credential():
    sources = [bool(os.environ.get(k)) for k in ("THG_ETAPI_TOKEN", "THG_ETAPI_TOKEN_FILE", "THG_ETAPI_TOKEN_STDIN")]
    if sum(sources) != 1:
        raise Refused("Choose exactly one protected environment, file or stdin credential source")
    if sources[0]:
        token = os.environ["THG_ETAPI_TOKEN"]
    elif sources[1]:
        path = os.environ["THG_ETAPI_TOKEN_FILE"]
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd) as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
                    raise Refused("Credential file must be owner-only, regular and owned by the operator")
                token = stream.read(8193).strip()
        except OSError:
            raise Refused("Cannot read protected credential file") from None
    else:
        if sys.stdin.isatty():
            raise Refused("Provide credential via piped stdin")
        token = sys.stdin.read(8193).strip()
    if not token or len(token) > 8192 or any(c.isspace() for c in token):
        raise Refused("Invalid credential input")
    return token


class ETAPI:
    def __init__(self, url, token):
        self.base = validate_url(url)
        self.token = token
        # Disable environment proxies and redirects to prevent credential forwarding.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, method, path, body=None, text=False, missing=False):
        headers = {"Authorization": self.token}
        payload = None
        if body is not None:
            headers["Content-Type"] = "text/plain; charset=utf-8" if text else "application/json"
            payload = body.encode() if text else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=payload, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=20) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise Refused("ETAPI response exceeds bounded size")
                if response.status == 204:
                    return None
                return raw.decode() if text else json.loads(raw)
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            raise Refused(f"ETAPI HTTP {error.code}; response withheld") from None
        except (urllib.error.URLError, OSError, ValueError):
            raise Refused("ETAPI transport or response failure; details withheld") from None
