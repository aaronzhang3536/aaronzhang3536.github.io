import uuid
from django.conf import settings
from django.db import models


class Application(models.Model):
    slug = models.SlugField(primary_key=True)
    name = models.CharField(max_length=100)
    enabled = models.BooleanField(default=True)
    public_signup = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class Membership(models.Model):
    application = models.ForeignKey(Application, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["application", "user"], name="frame_membership_unique")]


class AppSession(models.Model):
    token = models.OneToOneField("commerce.ApiToken", on_delete=models.CASCADE, primary_key=True)
    application = models.ForeignKey(Application, on_delete=models.CASCADE)


class State(models.Model):
    application = models.ForeignKey(Application, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    version = models.PositiveBigIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["application", "user"], name="frame_state_unique")]


class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    state = models.ForeignKey(State, on_delete=models.CASCADE, related_name="records")
    key = models.CharField(max_length=100)
    value = models.JSONField(null=True)  # null is a retained deletion tombstone.
    modified_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["state", "key"], name="frame_record_unique")]


class Operation(models.Model):
    state = models.ForeignKey(State, on_delete=models.CASCADE)
    operation_id = models.UUIDField()
    digest = models.CharField(max_length=64)
    version = models.PositiveBigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["state", "operation_id"], name="frame_operation_unique")]
