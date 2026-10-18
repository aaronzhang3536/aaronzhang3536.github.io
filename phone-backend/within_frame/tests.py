import json
import uuid
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from commerce.models import ApiToken, Product, RateLimit
from commerce.services import digest, issue_token
from .models import Application, Membership, AppSession, Record, State


@override_settings(SECURE_SSL_REDIRECT=False, WOF_ALLOWED_ORIGINS=["https://aaronzhang3536.github.io"])
class IntegrationTests(TestCase):
    def setUp(self):
        RateLimit.objects.all().delete()
        self.password = "Test-only-Frame-581!"
        self.a = get_user_model().objects.create_user("frame-a", password=self.password)
        self.b = get_user_model().objects.create_user("frame-b", password=self.password)
        Product.objects.create(slug="frame-other", name="Other")
        Application.objects.create(slug="frame-other", name="Other", public_signup=True)
        self.token = self.login("frame-a")
        self.other_user = self.login("frame-b")
        self.other_app = self.login("frame-a", "frame-other")
        self.path = "/api/v1/apps/within-one-frame"

    def call(self, method, path, data=None, token=None, **extra):
        return self.client.generic(method, path, json.dumps(data or {}), content_type="application/json", HTTP_AUTHORIZATION="Bearer " + (token or self.token), **extra)

    def login(self, name, app="within-one-frame"):
        response = self.client.post("/api/v1/login", json.dumps({"username": name, "password": self.password, "product": app}), content_type="application/json")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["token"]

    def put(self, values, base=0, op=None, **kwargs):
        return self.call("PUT", self.path + "/state", {"values": values, "base": base, "operation_id": str(op or uuid.uuid4())}, **kwargs)

    def test_reuses_existing_account_and_current_user(self):
        self.assertEqual(self.call("GET", "/api/v1/me").json()["id"], self.a.id)
        self.assertEqual(get_user_model().objects.filter(username="frame-a").count(), 1)
        self.assertTrue(Membership.objects.filter(user=self.a, application_id="within-one-frame", active=True).exists())

    def test_registration_returns_scoped_session(self):
        response = self.client.post("/api/v1/register", json.dumps({"username": "fresh-frame", "password": self.password, "product": "within-one-frame"}), content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(AppSession.objects.filter(token__digest=digest(response.json()["token"]), application_id="within-one-frame").exists())

    def test_crud_and_tombstone(self):
        response = self.call("POST", self.path + "/records", {"key": "wof:bookmarks", "value": '["article"]', "base": 0, "operation_id": str(uuid.uuid4())})
        self.assertEqual(response.status_code, 200)
        item = response.json()["record"]["id"]
        detail = self.path + "/records/" + item
        self.assertEqual(self.call("GET", detail).json()["record"]["value"], '["article"]')
        self.assertEqual(self.call("PATCH", detail, {"value": "[]", "base": 1, "operation_id": str(uuid.uuid4())}).status_code, 200)
        self.assertEqual(self.call("DELETE", detail, {"base": 2, "operation_id": str(uuid.uuid4())}).status_code, 200)
        self.assertEqual(self.call("GET", self.path + "/records").json()["records"], [])
        self.assertIsNone(self.call("GET", self.path + "/state").json()["values"]["wof:bookmarks"])

    def test_other_user_cannot_read_change_or_delete_object(self):
        self.put({"wof:bookmarks": '["private"]'})
        item = str(Record.objects.get().pk)
        for method in ("GET", "PATCH", "DELETE"):
            self.assertEqual(self.call(method, self.path + "/records/" + item, {"base": 1, "operation_id": str(uuid.uuid4()), "value": "[]"}, token=self.other_user).status_code, 404)
        self.assertEqual(self.call("GET", self.path + "/state", token=self.other_user).json()["values"], {})

    def test_cross_application_token_and_path_denied(self):
        for method in ("GET", "PUT", "POST", "DELETE"):
            self.assertEqual(self.call(method, self.path + "/state", token=self.other_app).status_code, 403)
        self.assertEqual(self.call("GET", "/api/v1/apps/frame-other/state").status_code, 403)
        self.assertEqual(self.call("GET", "/api/v1/licenses").status_code, 403)

    def test_unscoped_account_token_not_accepted(self):
        token, _ = issue_token(self.a)
        self.assertEqual(self.call("GET", self.path + "/state", token=token).status_code, 403)

    def test_revoked_membership_denied_and_not_reactivated_by_login(self):
        Membership.objects.filter(user=self.a, application_id="within-one-frame").update(active=False)
        self.assertEqual(self.call("GET", self.path + "/state").status_code, 403)
        response = self.client.post("/api/v1/login", json.dumps({"username": "frame-a", "password": self.password, "product": "within-one-frame"}), content_type="application/json")
        self.assertEqual(response.status_code, 403)

    def test_expired_and_logout_only_current_session(self):
        ApiToken.objects.filter(digest=digest(self.token)).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.call("GET", self.path + "/state").status_code, 401)
        self.assertEqual(self.call("GET", "/api/v1/apps/frame-other/state", token=self.other_app).status_code, 200)
        self.assertEqual(self.call("POST", "/api/v1/logout", token=self.other_app).status_code, 200)
        self.assertEqual(self.call("GET", "/api/v1/apps/frame-other/state", token=self.other_app).status_code, 401)
        self.assertEqual(self.call("GET", self.path + "/state", token=self.other_user).status_code, 200)

    def test_password_change_revokes_all_sessions(self):
        self.assertEqual(self.call("POST", "/api/v1/password", {"current_password": self.password, "new_password": "Another-safe-Test-981!"}).status_code, 200)
        self.assertEqual(self.call("GET", "/api/v1/apps/frame-other/state", token=self.other_app).status_code, 401)

    def test_idempotency_and_stale_version(self):
        op = uuid.uuid4()
        self.assertEqual(self.put({"yzzn-fish": "2"}, op=op).status_code, 200)
        self.assertTrue(self.put({"yzzn-fish": "2"}, op=op).json()["replayed"])
        self.assertEqual(self.put({"yzzn-fish": "3"}, op=op).status_code, 409)
        self.assertEqual(self.put({"yzzn-fish": "3"}).status_code, 409)
        self.assertEqual(State.objects.get(user=self.a, application_id="within-one-frame").version, 1)

    def test_batch_owner_and_application_spoof_rejected(self):
        body = {"values": {"wof:bookmarks": "[]"}, "base": 0, "operation_id": str(uuid.uuid4()), "user_id": self.b.id}
        self.assertEqual(self.call("PUT", self.path + "/state", body).status_code, 400)
        self.assertEqual(self.call("GET", self.path + "/state", HTTP_X_COMMONTOOLS_PRODUCT="frame-other").status_code, 403)

    def test_invalid_or_sensitive_payload_is_atomic(self):
        for key in ("yzzn-en-cfg", "yzzn-cloud", "yzzn-wx-live", "birth", "__proto__"):
            self.assertEqual(self.put({"wof:bookmarks": "[]", key: "{}"}).status_code, 400)
        self.assertEqual(self.put({"yzzn-en-words": '[{"w":"hello","api_key":"secret"}]'}).status_code, 400)
        self.assertEqual(Record.objects.count(), 0)

    def test_supported_business_shapes(self):
        values = {"yzzn-en-words": '[{"w":"hello","def":"你好","mt":123,"srs":{"ef":2.5,"n":1,"i":1,"d":200}}]', "yzzn-ja-words": '[{"w":"猫","r":"ねこ","rom":"neko","def":"猫","due":200,"iv":1,"ef":2.5,"rep":1,"mt":100}]', "yzzn-uke-plan": '{"0-1":false}', "yzzn-arc-mines": "12", "yzzn-fish": "4", "babel-manual": '{"hello":2}', "yzzn-gy-history": '[{"i":1,"s":"手动","t":100}]', "wof:reading-size": "16", "yzzn-theme": "dark"}
        self.assertEqual(self.put(values).status_code, 200)
        self.assertEqual(self.call("GET", self.path + "/state").json()["values"], values)

    def test_reset_blocks_old_client_recreation(self):
        self.put({"babel-manual": '{"hello":3}'})
        self.assertEqual(self.put({"babel-manual": "{}"}, base=1).status_code, 200)
        self.assertEqual(self.put({"babel-manual": '{"hello":3,"cat":1}'}, base=1).status_code, 409)

    def test_cors_preflight_exact_origin_and_no_http_redirect(self):
        response = self.client.options(self.path + "/state", HTTP_ORIGIN="https://aaronzhang3536.github.io")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response["Access-Control-Allow-Origin"], "https://aaronzhang3536.github.io")
        self.assertEqual(self.client.options(self.path + "/state", HTTP_ORIGIN="https://evil.example").status_code, 403)

    def test_browser_cookie_does_not_authenticate_api(self):
        self.client.force_login(self.a)
        self.assertEqual(self.client.get(self.path + "/state").status_code, 401)

    def test_staff_management_uses_same_user_and_membership_scope(self):
        from django.contrib.auth.models import Permission
        self.put({"yzzn-fish": "1"})
        self.put({"yzzn-fish": "2"}, token=self.other_user)
        self.a.is_staff = True
        self.a.save(update_fields=["is_staff"])
        self.a.user_permissions.add(Permission.objects.get(codename="view_record", content_type__app_label="within_frame"))
        self.client.force_login(self.a)
        response = self.client.get("/admin/within_frame/record/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(list(response.context["cl"].queryset.values_list("state__user_id", flat=True)), [self.a.id])
        other_id = Record.objects.get(state__user=self.b).pk
        self.assertEqual(self.client.get(f"/admin/within_frame/record/{other_id}/change/").status_code, 302)
        Membership.objects.filter(user=self.a, application_id="within-one-frame").update(active=False)
        response = self.client.get("/admin/within_frame/record/")
        self.assertEqual(response.context["cl"].queryset.count(), 0)
