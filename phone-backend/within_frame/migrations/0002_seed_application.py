from django.db import migrations


def seed(apps, schema_editor):
    apps.get_model("commerce", "Product").objects.get_or_create(slug="within-one-frame", defaults={"name": "一帧之内", "description": "个人学习与生活数据", "enabled": False})
    apps.get_model("within_frame", "Application").objects.get_or_create(slug="within-one-frame", defaults={"name": "一帧之内", "enabled": True, "public_signup": True})


class Migration(migrations.Migration):
    dependencies = [("within_frame", "0001_initial"), ("commerce", "0002_productmembership")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
