from django.urls import path
from . import api

urlpatterns = [
    path("api/v1/apps/<slug:app>/state", api.state_view),
    path("api/v1/apps/<slug:app>/records", api.records),
    path("api/v1/apps/<slug:app>/records/<uuid:record_id>", api.record),
]
