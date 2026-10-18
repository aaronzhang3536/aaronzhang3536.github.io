"""Explicit live smoke test using disposable accounts; state file contains test secrets.

Never commit the state file. Provision a disposable second Application first; remove
the exact recorded users and application after restart/expiry/browser verification.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import secrets
import time
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["first", "restart", "expired", "logout"])
parser.add_argument("--state", type=pathlib.Path, required=True)
parser.add_argument("--report", type=pathlib.Path, required=True)
parser.add_argument("--other", default="within-frame-verification")
args = parser.parse_args()
AUTH = "https://api.zhangjieyi.cn/api/v1"
API = "https://within-one-frame.zhangjieyi.cn/api/v1"
APP = "within-one-frame"
ORIGIN = "https://aaronzhang3536.github.io"
state = json.loads(args.state.read_text(encoding="utf-8-sig")) if args.state.exists() else {}
report = json.loads(args.report.read_text(encoding="utf-8-sig")) if args.report.exists() else []


def save():
    args.state.write_text(json.dumps(state, indent=2), encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def check(name, ok):
    report.append({"time": datetime.datetime.now(datetime.timezone.utc).isoformat(), "check": name, "passed": bool(ok)})
    save()
    if not ok:
        raise AssertionError(name)
    print("PASS", name, flush=True)


def call(path, method="GET", body=None, token=None, auth=False, origin=ORIGIN):
    headers = {"Origin": origin, "Content-Type": "application/json", "User-Agent": "WithinOneFrameIntegrationCheck/1.0"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request((AUTH if auth else API) + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    for attempt in range(3):
        try:
            response = urllib.request.urlopen(request, timeout=20)
            break
        except urllib.error.HTTPError as error:
            response = error
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)
    data = response.read()
    try:
        result = json.loads(data) if data else {}
    except ValueError:
        raise RuntimeError(f"Non-JSON response: HTTP {response.status}, content-type {response.headers.get('Content-Type')}, body prefix {data[:160]!r}")
    return response.status, result, {k.lower(): v for k, v in response.headers.items()}


def op(base, **fields):
    return {"base": base, "operation_id": str(uuid.uuid4()), **fields}


base = f"/apps/{APP}"
if args.mode == "first":
    if state.get("persistent_snapshot"):
        raise SystemExit("State file already exists; choose a new test run")
    if not state:
        suffix = str(int(time.time())) + "-" + secrets.token_hex(2)
        state.update(other=args.other, users=["wof-check-" + suffix + "-a", "wof-check-" + suffix + "-b"], password=secrets.token_urlsafe(24))
    save()
    tokens = state.get("tokens", [])
    for username in state["users"][len(tokens):]:
        status, result, _ = call("/register", "POST", {"username": username, "password": state["password"], "product": APP}, auth=True)
        check("public account registration " + username[-1], status == 200 and bool(result.get("token")))
        tokens.append(result["token"])
        state["tokens"] = tokens
        save()
    ta, tb = tokens
    if not state.get("other_token"):
        status, result, _ = call("/login", "POST", {"username": state["users"][0], "password": state["password"], "product": args.other}, auth=True)
        check("same account login in second application", status == 200)
        state["other_token"] = result["token"]
    tc = state["other_token"]
    save()
    status, result, _ = call("/me", token=ta, auth=True)
    check("current user verified by common API", status == 200 and result["username"] == state["users"][0])
    state["user_id"] = result["id"]
    status, _, headers = call(base + "/state", "OPTIONS")
    check("HTTPS CORS preflight", status == 204 and headers.get("access-control-allow-origin") == ORIGIN)
    check("untrusted Origin denied", call(base + "/state", "OPTIONS", origin="https://evil.example")[0] == 403)
    check("anonymous denied", call(base + "/state")[0] == 401)
    status, result, _ = call(base + "/records", "POST", op(0, key="wof:bookmarks", value='["test-article"]'), ta)
    check("create bookmark record", status == 200)
    record = base + "/records/" + result["record"]["id"]
    check("read record", call(record, token=ta)[1]["record"]["value"] == '["test-article"]')
    check("update/cancel bookmark", call(record, "PATCH", op(1, value="[]"), ta)[0] == 200)
    for method in ("GET", "PATCH", "DELETE"):
        check("other user denied " + method, call(record, method, None if method == "GET" else op(2, value="[]"), tb)[0] == 404)
    check("other user list isolated", call(base + "/records", token=tb)[1]["records"] == [])
    for method in ("GET", "PUT", "POST", "DELETE"):
        check("other application denied " + method, call(base + "/state", method, None if method == "GET" else {}, tc)[0] == 403)
    check("wrong application URL denied", call(f"/apps/{args.other}/state", token=ta)[0] == 403)
    check("second application has independent data", call(f"/apps/{args.other}/state", token=tc)[1]["values"] == {})
    check("delete bookmark", call(record, "DELETE", op(2), ta)[0] == 200)
    check("deletion tombstone retained", call(base + "/state", token=ta)[1]["values"]["wof:bookmarks"] is None)
    values = {
        "yzzn-en-words": json.dumps([{"w": "persistence-check", "def": "临时测试词条", "mt": int(time.time()*1000), "srs": {"ef": 2.5, "n": 1, "i": 1, "d": int(time.time()*1000)}}]),
        "yzzn-en-stats": '{"2026-10-18":2}', "yzzn-ja-dojo": '{"basic:猫":[2,1]}',
        "yzzn-uke-plan": '{"0-1":false}', "yzzn-uke-rhythm": '{"0|normal|4":{"score":80,"grade":"A","acc":90}}',
        "yzzn-fish": "7", "yzzn-arc-mines": "12", "wof:reading-size": "16",
        "yzzn-xlr-history": '[{"n":[1,2,3],"p":[0,1,3],"s":"temporary test","t":100}]',
        "babel-manual": '{"test":2}', "wof:bookmarks": None,
    }
    request = op(3, values=values)
    status, result, _ = call(base + "/state", "PUT", request, ta)
    check("typed batch business data saved", status == 200)
    check("lost-response retry is idempotent", call(base + "/state", "PUT", request, ta)[1].get("replayed") is True)
    check("stale write conflicts", call(base + "/state", "PUT", op(3, values={"yzzn-fish": "99"}), ta)[0] == 409)
    check("secret fields rejected atomically", call(base + "/state", "PUT", op(4, values={"yzzn-en-cfg": '{"key":"never-store"}'}), ta)[0] == 400)
    values["babel-manual"] = "{}"
    check("manual reset saved", call(base + "/state", "PUT", op(4, values=values), ta)[0] == 200)
    check("old client cannot resurrect reset", call(base + "/state", "PUT", op(4, values={"babel-manual": '{"test":3}'}), ta)[0] == 409)
    current = call(base + "/state", token=ta)[1]
    state["persistent_snapshot"] = current
    save()
    check("persisted data exactly matches submitted values", current["values"] == values and current["version"] == 5)
elif args.mode == "restart":
    status, result, _ = call(base + "/state", token=state["tokens"][0])
    check("data survives actual backend service restart", status == 200 and result == state["persistent_snapshot"])
elif args.mode == "expired":
    check("expired server token denied", call(base + "/state", token=state["tokens"][0])[0] == 401)
    check("other application session remains valid", call(f"/apps/{state['other']}/state", token=state["other_token"])[0] == 200)
elif args.mode == "logout":
    check("logout current common session", call("/logout", "POST", {}, state["tokens"][1], auth=True)[0] == 200)
    check("logged out token cannot be reused", call(base + "/state", token=state["tokens"][1])[0] == 401)
    check("logout does not revoke other application", call(f"/apps/{state['other']}/state", token=state["other_token"])[0] == 200)
