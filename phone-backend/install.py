"""Install this additive app into the inspected CommonTools source directory."""
import argparse
import pathlib
import shutil

parser = argparse.ArgumentParser()
parser.add_argument("target", type=pathlib.Path)
args = parser.parse_args()
root = args.target.resolve()
assert (root / "commerce/api.py").is_file(), "Expected the existing CommonTools backend"
shutil.copytree(pathlib.Path(__file__).parent / "within_frame", root / "within_frame", dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
settings = root / "config/settings.py"
text = settings.read_text(encoding="utf-8")
marker = "# Within One Frame integration"
if marker not in text:
    text += '''\n# Within One Frame integration
INSTALLED_APPS += ["within_frame"]
MIDDLEWARE.insert(0, "within_frame.middleware.FrameMiddleware")
WOF_ALLOWED_ORIGINS = [x.strip() for x in os.environ.get("WOF_ALLOWED_ORIGINS", "https://aaronzhang3536.github.io,https://within-one-frame.zhangjieyi.cn").split(",") if x.strip()]
DATA_UPLOAD_MAX_MEMORY_SIZE = 3 * 1024 * 1024
'''
    settings.write_text(text, encoding="utf-8")
urls = root / "config/urls.py"
text = urls.read_text(encoding="utf-8")
if marker not in text:
    text += '\n# Within One Frame integration\nfrom within_frame.urls import urlpatterns as frame_urls\nurlpatterns = frame_urls + urlpatterns\n'
    urls.write_text(text, encoding="utf-8")
print("Installed within_frame source and configuration hooks")
