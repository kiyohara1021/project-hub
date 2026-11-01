"""Interactive production checks. Passwords/sessions stay in memory, never in reports.

Only empty, invalid JSON is sent to mutation endpoints: even if a permission
check regresses, validation prevents creating/updating application records.
Use a pre-existing isolated workspace with no memberships for --other-workspace.
"""
import argparse
import getpass
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("origin", "workspace", "other-workspace", "project", "output"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    origin = urllib.parse.urlsplit(args.origin)
    if (origin.scheme != "https" or origin.netloc != origin.hostname
            or origin.path or origin.query or origin.fragment):
        parser.error("Use an exact HTTPS origin without credentials/path/query")
    for value in (args.workspace, args.other_workspace, args.project):
        uuid.UUID(value)
    if args.workspace == args.other_workspace:
        parser.error("The isolated workspace must differ from the accessible workspace")
    report = {"origin": args.origin, "checks": []}
    results = report["checks"]

    def record(role, name, passed, **details):
        results.append(dict(role=role, check=name, passed=passed, **details))
        print(("PASS" if passed else "FAIL") + " " + role + " " + name, flush=True)
        if not passed:
            raise RuntimeError("Verification failed; see sanitized report")

    for role in ("member", "viewer"):
        print("Login destination: " + args.origin + "/auth/login", flush=True)
        password = getpass.getpass(role + "@example.invalid password (not saved): ")
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())

        def request(path, method="GET", data=None, request_origin=args.origin, form=False):
            headers = {"User-Agent": "ProjectHub-release-verifier"}
            if request_origin is not None:
                headers["Origin"] = request_origin
            body = None
            if data is not None:
                body = (urllib.parse.urlencode(data) if form else json.dumps(data)).encode()
                headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
            req = urllib.request.Request(args.origin + path, data=body, headers=headers, method=method)
            start = time.monotonic()
            try:
                response = opener.open(req, timeout=45)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                payload = response.read()
                return response.status, response.headers, payload, round((time.monotonic() - start) * 1000)

        try:
            status, headers, _, _ = request("/auth/login", "POST", {"email": role + "@example.invalid", "password": password}, form=True)
            password = None
            record(role, "login", status == 303 and headers.get("Location") == args.origin + "/workspaces", status=status)
            auth = [cookie for cookie in jar if cookie.name.startswith("sb-") and "auth-token" in cookie.name]
            attributes = [{"secure": c.secure, "path": c.path, "sameSite": next((str(v).lower() for k, v in c._rest.items() if k.lower() == "samesite"), None), "hostOnly": not c.domain_specified, "httpOnly": any(k.lower() == "httponly" for k in c._rest)} for c in auth]
            record(role, "cookie-attributes", bool(auth) and all(c["secure"] and c["path"] == "/" and c["sameSite"] == "lax" and c["hostOnly"] for c in attributes), attributes=attributes)
            base = "/api/v1/workspaces/" + args.workspace
            project = base + "/projects/" + args.project
            for suffix in ("/dashboard", "/projects", "/members", "/activity", "/projects/" + args.project + "/tasks", "/projects/" + args.project + "/issues"):
                status, headers, _, elapsed = request(base + suffix)
                record(role, "read" + suffix, status == 200 and "no-store" in headers.get("Cache-Control", ""), status=status, response_ms=elapsed)
            blocked = [(base + "/projects", "POST"), (base + "/members/00000000-0000-4000-8000-000000000000", "PATCH")]
            if role == "viewer":
                blocked += [(project + "/tasks", "POST"), (project + "/issues", "POST")]
            for path, method in blocked:
                status, _, payload, _ = request(path, method, {})
                code = json.loads(payload).get("error", {}).get("code")
                record(role, "denied-" + method + path, status == 403 and code == "FORBIDDEN", status=status, code=code)
            for foreign_origin in ("https://example.invalid", "null", None):
                status, _, payload, _ = request(project + "/tasks", "POST", {}, request_origin=foreign_origin)
                code = json.loads(payload).get("error", {}).get("code")
                record(role, "origin-" + (foreign_origin or "missing"), status == 403 and code == "INVALID_ORIGIN", status=status, code=code)
            other = "/api/v1/workspaces/" + args.other_workspace
            for suffix in ("/dashboard", "/projects", "/members", "/activity", "/projects/" + args.project + "/tasks", "/projects/" + args.project + "/issues"):
                status, _, payload, _ = request(other + suffix)
                code = json.loads(payload).get("error", {}).get("code")
                record(role, "other-workspace" + suffix, status == 404 and code == "NOT_FOUND", status=status, code=code)
        finally:
            password = None
            if len(jar):
                status, _, _, _ = request("/auth/logout", "POST", {}, form=True)
                record(role, "logout", status == 303, status=status)
            status, _, _, _ = request("/api/v1/workspaces/" + args.workspace + "/projects")
            record(role, "anonymous-after-logout", status == 401, status=status)
            jar.clear()
            Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("Finished. Sanitized results: " + args.output)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, urllib.error.URLError):
        print("Stopped: a check or connection failed. No credentials printed.", file=sys.stderr)
        sys.exit(1)
