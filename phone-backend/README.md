# CommonTools 的一帧之内数据扩展

本目录只包含本应用扩展，依赖现有 CommonTools 后端的 commerce 账号、ApiToken、Product 和频控实现。生产安装前读取 [接入与恢复说明](../docs/phone-backend-integration.md)，先备份数据库、源码和配置。

在装有现有后端依赖的 Python 环境执行：

```text
python install.py <现有CommonTools后端目录>
python <现有CommonTools后端目录>/manage.py check
python <现有CommonTools后端目录>/manage.py makemigrations --check --dry-run
python <现有CommonTools后端目录>/manage.py test within_frame commerce --noinput
python <现有CommonTools后端目录>/manage.py migrate --noinput
```

install.py 仅复制 within_frame 并追加 settings/urls 挂接。configure_phone.py 专用于已检查的 Android/Termux 路径和既有 Nginx/Tunnel 结构；它不启动服务、不创建 DNS，也不代替备份。执行后必须校验代理与隧道配置，确认数据库迁移成功，再重启服务。

verify_live.py 会通过公网创建测试账号并修改这些账号的真实数据；必须明确指定私有状态与报告文件。预先建立独立测试 Application / Product，完成后按状态文件中的确切名单清理。状态文件含临时密码和令牌，不能提交或放入公开静态资源目录。

完整接口、数据范围、权限语义和验证结果见 docs/phone-backend-*.md。部署不改动原付费授权规则、不设置新商业价格。
