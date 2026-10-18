"""Add the dedicated virtual host without replacing unrelated production settings.

Run only after backup and install.py. Paths intentionally match the inspected phone.
"""
from pathlib import Path
import os
from dotenv import dotenv_values, set_key

home = Path.home()
prefix = Path(os.environ["PREFIX"])
backend = home / "commontools-backend"
env = backend / ".env"
domain = "within-one-frame.zhangjieyi.cn"
hosts = dotenv_values(env).get("ALLOWED_HOSTS", "").split(",")
if domain not in hosts:
    set_key(env, "ALLOWED_HOSTS", ",".join([h for h in hosts if h] + [domain]))
origins = dotenv_values(env).get("WOF_ALLOWED_ORIGINS", "").split(",")
for origin in ("https://aaronzhang3536.github.io", f"https://{domain}", "https://within-one-frame-f6egecj3.edgeone.cool"):
    if origin not in origins:
        origins.append(origin)
set_key(env, "WOF_ALLOWED_ORIGINS", ",".join(o for o in origins if o))
nginx = prefix / "etc/nginx/nginx.conf"
text = nginx.read_text()
include = f"    include {prefix}/etc/nginx/within-one-frame.conf;"
if include not in text:
    anchor = f"    include {prefix}/etc/nginx/commontools.conf;"
    assert anchor in text, "Nginx structure changed; inspect before configuring"
    text = text.replace(anchor, anchor + "\n" + include)
    text = text.replace("        location /api/v1/ {", "        location = /api/v1 {\n            default_type application/json;\n            return 200 '{\"service\":\"commontools-backend\",\"version\":1}';\n        }\n\n        location /api/v1/ {\n            client_max_body_size 3m;")
    nginx.write_text(text)
proxy = '''
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $http_cf_connecting_ip;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
'''
conf = f'''# Within One Frame: authenticated Django API and account-management entry.
server {{
    listen 127.0.0.1:8080;
    server_name {domain};
    client_max_body_size 3m;
    location = /api/v1 {{ default_type application/json; return 200 '{{"service":"within-one-frame","version":1}}'; }}
    location /api/v1/ {{{proxy}    }}
    location /admin/ {{{proxy}    }}
    location /static/ {{{proxy}    }}
    location /health/ {{{proxy}    }}
    location = / {{ return 302 https://aaronzhang3536.github.io/account/; }}
    location = /account/ {{ return 302 https://aaronzhang3536.github.io/account/; }}
    location / {{ return 404; }}
}}
'''
(prefix / "etc/nginx/within-one-frame.conf").write_text(conf)
tunnel = home / ".cloudflared/config.yml"
text = tunnel.read_text()
if f"hostname: {domain}" not in text:
    anchor = "  - service: http_status:404"
    assert anchor in text, "Tunnel structure changed; inspect before configuring"
    text = text.replace(anchor, f"  - hostname: {domain}\n    service: http://127.0.0.1:8080\n" + anchor)
    tunnel.write_text(text)
print("Configured Django host, dedicated Nginx virtual host and Tunnel ingress")
