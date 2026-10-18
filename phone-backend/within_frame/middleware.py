import json
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse, HttpResponse
from django.utils import timezone
from commerce.models import ApiToken
from commerce.services import digest
from .models import Application, Membership, AppSession


class FrameMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get("Origin")
        is_api = request.path.startswith("/api/v1/")
        allowed = origin in settings.WOF_ALLOWED_ORIGINS
        if is_api and origin and not allowed:
            return JsonResponse({"error": "此站点未获准访问。"}, status=403)
        if is_api and request.method == "OPTIONS":
            response = HttpResponse(status=204)
        else:
            response = self.dispatch(request)
        if is_api:
            response["Cache-Control"] = "no-store"
            if allowed:
                response["Access-Control-Allow-Origin"] = origin
                response["Vary"] = "Origin"
                response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
                response["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-CommonTools-Product"
                response["Access-Control-Max-Age"] = "600"
        return response

    def dispatch(self, request):
        supplied = request.headers.get("Authorization", "")
        if supplied.startswith("Bearer ") and len(supplied) <= 100:
            bound = AppSession.objects.filter(token__digest=digest(supplied[7:])).first()
            if bound:
                permitted = request.path in ("/api/v1/me", "/api/v1/logout", "/api/v1/password") or request.path.startswith(f"/api/v1/apps/{bound.application_id}/")
                if request.path.startswith("/api/v1/") and not permitted:
                    return JsonResponse({"error": "会话不能访问另一应用。"}, status=403)
                header = request.headers.get("X-CommonTools-Product")
                if header and header != bound.application_id:
                    return JsonResponse({"error": "应用标识与会话不匹配。"}, status=403)
        if request.path in ("/api/v1/login", "/api/v1/register") and request.method == "POST" and request.content_type == "application/json":
            try:
                data = json.loads(request.body)
                app = Application.objects.filter(slug=data.get("product")).first() if type(data) is dict else None
            except (ValueError, TypeError):
                app = None
            if app:
                if not app.enabled:
                    return JsonResponse({"error": "应用已停用。"}, status=403)
                # Wrap the existing public-account view; reuse its validation, hashing and throttling.
                with transaction.atomic():
                    response = self.get_response(request)
                    if response.status_code == 200:
                        result = json.loads(response.content)
                        token = ApiToken.objects.get(digest=digest(result["token"]))
                        member = Membership.objects.filter(application=app, user=token.user).first()
                        if member is None and app.public_signup:
                            member = Membership.objects.create(application=app, user=token.user)
                        if member is None or not member.active:
                            token.delete()
                            return JsonResponse({"error": "账号没有此应用的访问权限。"}, status=403)
                        AppSession.objects.create(token=token, application=app)
                    return response
        return self.get_response(request)
