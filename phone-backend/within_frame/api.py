import hashlib
import json
import uuid
from functools import wraps
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from commerce.models import ApiToken
from commerce.services import BusinessError, digest, throttle
from .models import AppSession, Membership, State, Record, Operation
from .validation import validate, validate_values, require


def endpoint(methods):
    def decorate(view):
        @csrf_exempt
        @wraps(view)
        def wrapped(request, app, **kwargs):
            try:
                if request.method not in methods:
                    response = JsonResponse({"error": "请求方法不支持。"}, status=405)
                    response["Allow"] = ", ".join(methods)
                    return response
                supplied = request.headers.get("Authorization", "")
                if not supplied.startswith("Bearer ") or len(supplied) > 100:
                    raise BusinessError("请先登录。", 401)
                token = ApiToken.objects.filter(digest=digest(supplied[7:]), expires_at__gt=timezone.now(), user__is_active=True).first()
                if token is None:
                    raise BusinessError("登录已过期，请重新登录。", 401)
                if not AppSession.objects.filter(token=token, application_id=app, application__enabled=True).exists() or not Membership.objects.filter(application_id=app, user=token.user, active=True).exists():
                    raise BusinessError("没有此应用的权限。", 403)
                request.frame_user = token.user
                request.frame_data = {}
                if request.method in ("POST", "PUT", "PATCH", "DELETE"):
                    if request.content_type != "application/json":
                        raise BusinessError("需要 application/json。", 415)
                    request.frame_data = json.loads(request.body or b"{}")
                    require(type(request.frame_data) is dict)
                    throttle(request, "frame-write", maximum=180, seconds=60)
                # Existing SQLite IMMEDIATE transactions serialize version checks and writes.
                with transaction.atomic():
                    state, _ = State.objects.get_or_create(application_id=app, user=token.user)
                    result, status = view(request, state, **kwargs)
                return JsonResponse(result, status=status)
            except BusinessError as error:
                return JsonResponse({"error": error.message}, status=error.status)
            except (ValueError, TypeError, OverflowError):
                return JsonResponse({"error": "请求参数无效。"}, status=400)
        return wrapped
    return decorate


def snapshot(state):
    return {"version": state.version, "values": dict(state.records.values_list("key", "value"))}


def mutation(request, state, changes):
    body = request.frame_data
    require(type(body.get("base")) is int and body["base"] >= 0)
    operation_id = uuid.UUID(body.get("operation_id", ""))
    signature = hashlib.sha256(json.dumps({"path": request.path, "method": request.method, "body": body}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    previous = Operation.objects.filter(state=state, operation_id=operation_id).first()
    if previous:
        if signature != previous.digest:
            raise BusinessError("操作标识已用于不同请求。", 409)
        return {"ok": True, "version": previous.version, "replayed": True}, 200
    if body["base"] != state.version:
        return {"error": "云端已有新修改，请先同步。", **snapshot(state)}, 409
    combined = dict(state.records.values_list("key", "value"))
    combined.update(changes)
    validate_values(combined)
    for key, value in changes.items():
        Record.objects.update_or_create(state=state, key=key, defaults={"value": value})
    state.version += 1
    state.save(update_fields=["version"])
    Operation.objects.create(state=state, operation_id=operation_id, digest=signature, version=state.version)
    return {"ok": True, "version": state.version}, 200


@endpoint(("GET", "PUT"))
def state_view(request, state):
    if request.method == "GET":
        return snapshot(state), 200
    require(set(request.frame_data) == {"base", "operation_id", "values"})
    values = request.frame_data["values"]
    validate_values(values)
    changes = {key: None for key in state.records.values_list("key", flat=True) if key not in values}
    changes.update(values)
    return mutation(request, state, changes)


def record_json(row):
    return {"id": str(row.id), "key": row.key, "value": row.value, "modified_at": row.modified_at.isoformat()}


@endpoint(("GET", "POST"))
def records(request, state):
    if request.method == "GET":
        return {"version": state.version, "records": [record_json(row) for row in state.records.exclude(value=None).order_by("key")]}, 200
    body = request.frame_data
    require(set(body) == {"base", "operation_id", "key", "value"})
    validate(body["key"], body["value"])
    result, status = mutation(request, state, {body["key"]: body["value"]})
    if status == 200:
        result["record"] = record_json(state.records.get(key=body["key"]))
    return result, status


@endpoint(("GET", "PATCH", "DELETE"))
def record(request, state, record_id):
    row = state.records.filter(pk=record_id).first()
    if row is None:
        raise BusinessError("记录不存在。", 404)
    if request.method == "GET":
        return {"version": state.version, "record": record_json(row)}, 200
    body = request.frame_data
    require(set(body) == ({"base", "operation_id", "value"} if request.method == "PATCH" else {"base", "operation_id"}))
    value = body.get("value") if request.method == "PATCH" else None
    validate(row.key, value)
    return mutation(request, state, {row.key: value})
