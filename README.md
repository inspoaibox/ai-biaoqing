# 微趣 · AI 表情工作台

这是一个面向微信表情创作者的 AI 创作后台，支持角色分析、静态图片、动态图 GIF、单个表情、套图表情、模型渠道管理、任务记录和素材库。

本文按“第一次部署 Linux 网站”的方式编写。照着顺序执行即可，不需要先理解 Node.js、PM2 或 Caddy 的内部原理。

## 一、部署前准备

你需要准备：

- 一台 Ubuntu 22.04/24.04 或 Debian 12 服务器
- 一个已经解析到服务器公网 IP 的域名，例如 `sticker.example.com`
- 云服务器安全组放行 `22`、`80`、`443` 端口
- GitHub 仓库访问权限：<https://github.com/inspoaibox/ai-biaoqing>

本项目要求 Node.js 22.5 或更高版本，因为服务端使用了 Node 内置 SQLite API。生产环境推荐使用 HTTPS，Caddy 会自动申请和续期证书。

## 二、登录 Linux 并安装基础环境

先通过 SSH 登录服务器：

```bash
ssh root@你的服务器IP
```

如果你使用的是云厂商提供的普通用户，把 `root` 换成对应用户名。

更新系统并安装 Git、Python 和编译工具：

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl ca-certificates build-essential python3 python3-pip python3-opencv python3-numpy
```

安装 Node.js 22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

`node -v` 应该显示 `v22.x` 或更高版本。如果仍然是 Node 18 或更低版本，请先处理 Node.js 安装问题，不要继续启动项目。

服务端的图像定位器默认在 Linux 使用 `python3`，并通过 `python3-opencv` 和 `python3-numpy` 提供 OpenCV 定位能力。模板中的 `STICKER_PYTHON_BIN: 'python3'` 一般不需要修改；如果你使用虚拟环境，可以把它改成虚拟环境中的 Python 绝对路径。

## 三、从 GitHub 克隆项目

建议把项目放在 `/var/www/ai-biaoqing`：

```bash
sudo mkdir -p /var/www
sudo chown -R "$USER":"$USER" /var/www
cd /var/www
git clone https://github.com/inspoaibox/ai-biaoqing.git
cd /var/www/ai-biaoqing
npm ci
```

检查目录是否正确：

```bash
pwd
ls
```

应该能看到 `package.json`、`server.mjs`、`src` 和 `README.md`。

以后更新代码时，在项目目录执行：

```bash
cd /var/www/ai-biaoqing
git pull --ff-only origin main
npm ci
```

## 四、创建生产环境配置

仓库中提供了 PM2 配置模板。复制一份到服务器本地：

```bash
cd /var/www/ai-biaoqing
cp ecosystem.config.example.cjs ecosystem.config.cjs
nano ecosystem.config.cjs
```

把下面几项改成自己的值：

```js
STICKER_ADMIN_EMAIL: '你的管理员邮箱',
STICKER_ADMIN_PASSWORD: '一段至少 12 位的随机密码',
STICKER_WEB_ORIGIN: 'https://你的域名',
```

例如：

```js
STICKER_ADMIN_EMAIL: 'admin@example.com',
STICKER_ADMIN_PASSWORD: '请使用密码生成器生成的长随机密码',
STICKER_WEB_ORIGIN: 'https://sticker.example.com',
```

注意：`ecosystem.config.cjs` 已经被 `.gitignore` 忽略，不要把它提交到 GitHub。不要把真实 API Key、管理员密码或 `data/sticker.sqlite` 发给别人。

保护配置文件：

```bash
chmod 600 ecosystem.config.cjs
mkdir -p data
```

管理员账号只会在数据库第一次创建时读取 `STICKER_ADMIN_EMAIL` 和 `STICKER_ADMIN_PASSWORD`。以后可以登录后台，在“默认设置 → 管理员账户”修改显示名称、登录邮箱和密码。

## 五、构建前端文件

```bash
cd /var/www/ai-biaoqing
npm run build
```

构建成功后会生成 `dist/` 目录。生产环境由 Caddy 直接提供 `dist/` 中的网页，Node 服务只负责 `/api` 请求和模型代理。

## 六、使用 PM2 启动后台服务

安装 PM2：

```bash
sudo npm install -g pm2
```

启动项目的 Node API 服务：

```bash
cd /var/www/ai-biaoqing
pm2 start ecosystem.config.cjs
pm2 status
```

查看日志：

```bash
pm2 logs ai-biaoqing-api
```

确认本机 API 已启动：

```bash
curl http://127.0.0.1:8787/api/health
```

应该能看到类似下面的 JSON：

```json
{"ok":true,"locator":true}
```

把 PM2 设置为服务器重启后自动恢复：

```bash
pm2 save
pm2 startup systemd
```

`pm2 startup systemd` 会打印一条带 `sudo` 的命令。复制它并执行，然后再次保存：

```bash
pm2 save
```

不要把 `8787` 端口暴露到公网，Caddy 会在本机转发请求。

## 七、安装 Caddy

如果服务器还没有 Caddy，执行官方 Debian/Ubuntu 安装方式：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

如果服务器本来就有 Caddy，请跳过安装步骤，先备份现有配置：

```bash
sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)"
```

## 八、给 Caddy 追加新域名配置

先在域名服务商处添加 DNS 记录：

- `A` 记录：`sticker.example.com` → 服务器公网 IPv4
- 如果服务器有 IPv6，再添加 `AAAA` 记录

编辑现有 Caddy 配置：

```bash
sudo nano /etc/caddy/Caddyfile
```

把下面这一整段**追加到文件末尾**，并把域名和项目路径换成自己的值：

```caddyfile
sticker.example.com {
    encode gzip

    # API 请求交给 Node 服务
    handle /api/* {
        reverse_proxy 127.0.0.1:8787
    }

    # 其余请求提供 Vite 构建后的前端，并支持 React 刷新路由
    handle {
        root * /var/www/ai-biaoqing/dist
        try_files {path} /index.html
        file_server
    }
}
```

这里有三个必须遵守的规则：

1. 保留 `/etc/caddy/Caddyfile` 中已有的全部内容。
2. 新域名使用一个新的站点块，追加到文件末尾。
3. 不要使用 `>`、`tee /etc/caddy/Caddyfile` 或其他会覆盖整个文件的命令。

如果 Caddyfile 中已经存在同一个域名，直接编辑原来的同名站点块，不要再添加第二个同名块。其他旧域名的配置不要移动、删除或替换。

检查配置语法：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

确认输出没有错误后，再启用并重新加载 Caddy：

```bash
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Caddy 会为域名自动申请 HTTPS 证书。等 DNS 生效后访问：

```text
https://sticker.example.com
```

## 九、设置防火墙

如果服务器启用了 UFW，只开放 SSH、HTTP 和 HTTPS：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

不要开放 `8787`，因为它只应该被 Caddy 在本机访问。

## 十、第一次登录和使用

1. 浏览器打开 `https://你的域名`。
2. 使用 `ecosystem.config.cjs` 中的管理员邮箱和密码登录。
3. 进入“默认设置 → 管理员账户”，修改显示名称、邮箱和密码。
4. 进入“模型渠道”，填写 OpenAI 兼容接口的 Base URL 和 API Key。
5. 点击“获取模型”，保存渠道模型。
6. 在“默认设置”中分别选择数据分析、静态图和动态图默认模型。
7. 回到“创作工作台”开始创建任务。

修改密码时必须填写当前密码。修改成功后，其他设备会退出登录，当前浏览器会自动保持登录。

## 十一、以后更新项目

每次发布新代码时：

```bash
cd /var/www/ai-biaoqing
git pull --ff-only origin main
npm ci
npm run build
pm2 restart ai-biaoqing-api --update-env
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

如果只修改了前端，仍然要执行 `npm run build`，否则 Caddy 仍会提供旧的 `dist/` 文件。

## 十二、常见问题排查

### 1. 网站显示 502 Bad Gateway

先确认 Node 服务是否运行：

```bash
pm2 status
pm2 logs ai-biaoqing-api --lines 100
curl http://127.0.0.1:8787/api/health
```

如果 `curl` 失败，先修复 PM2 服务；如果 `curl` 成功，再检查 Caddy 配置和日志：

```bash
sudo journalctl -u caddy -n 100 --no-pager
sudo caddy validate --config /etc/caddy/Caddyfile
```

### 2. Caddy reload 失败

不要直接重启和覆盖配置，先查看具体错误：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

如果是新站点块的缩进或括号问题，修正后再次验证。已有域名配置仍然保留。

### 3. 登录后马上掉线

检查 `STICKER_WEB_ORIGIN` 是否与浏览器地址完全一致：

```text
https://sticker.example.com
```

不要写成带路径的地址，例如 `https://sticker.example.com/app`。生产环境必须使用 HTTPS，并保留 `STICKER_SECURE_COOKIE: '1'`。

### 4. 修改配置后没有生效

修改 `ecosystem.config.cjs` 后执行：

```bash
pm2 restart ai-biaoqing-api --update-env
```

修改 Caddyfile 后执行：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 5. 端口被占用

```bash
sudo ss -ltnp | grep -E ':5173|:8787|:80|:443'
```

生产部署不需要启动 `npm run dev`，也不需要启动 Vite 开发服务器。生产流程是：PM2 启动 `server.mjs`，Caddy 提供 `dist/` 并转发 `/api`。

## 十三、备份管理员数据库

管理员账号、密码哈希和登录会话保存在 `data/sticker.sqlite`。建议定期备份：

```bash
sudo mkdir -p /var/backups/ai-biaoqing
sudo tar -czf "/var/backups/ai-biaoqing/sticker-$(date +%Y%m%d-%H%M%S).tar.gz" -C /var/www/ai-biaoqing data
```

不要把备份文件放进 GitHub，也不要把它公开下载。

## 十四、当前版本的数据范围

登录鉴权和管理员账号由 Node 服务端 SQLite 管理。渠道配置、项目、任务记录和素材大部分仍保存在浏览器的 IndexedDB/localStorage 中，适合单管理员或固定浏览器使用。

如果后续需要多台电脑共享渠道、任务和素材，需要继续把这些业务数据迁移到服务端数据库，并把图片放入对象存储。这不影响本手册中的单管理员公网部署流程。

## 十五、项目命令速查

```bash
# 本地开发：同时启动 API 代理和 Vite
npm run dev

# 类型检查并构建前端
npm run build

# 仅启动 API 服务（由 PM2 使用）
npm run server

# 查看远程仓库
git remote -v
```

项目地址：<https://github.com/inspoaibox/ai-biaoqing>
