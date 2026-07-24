# AssppWeb

[English](README.md) | [简体中文](README.zh-CN.md)

AssppWeb 是一个在浏览器中获取和安装 iOS 应用的工具。它支持 Apple ID 登录、App Store 搜索、许可证获取、历史版本查询、IPA 下载与安装包生成。

![项目预览](./resources/preview.png)

## 功能

- 在浏览器中完成 Apple ID 登录和多账号管理
- 搜索 App Store、获取应用许可证并下载 IPA
- 查询应用历史版本
- 为每个账号维护独立的设备标识符
- 根据 Apple 返回的 Pod 动态选择购买服务
- 使用 Wisp WebSocket 隧道转发 Apple TLS 流量
- 动态解析 Apple Bag 中的认证和下载端点
- 向 IPA 注入 SINF 与 `iTunesMetadata.plist`

## 零信任架构

后端不会接触 Apple ID 密码、Cookie、密码令牌或 DSID。所有 Apple API 请求都由浏览器中的 `libcurl.js` 和 Mbed TLS 1.3 发起，TLS 在浏览器端终止；后端只提供盲 TCP 转发。

后端能够看到的内容仅包括：

- Wisp 连接与目标主机等隧道元数据
- Apple 公开 CDN 下载地址
- 用于组装 IPA 的 SINF 和应用元数据

> **重要安全提示：** AssppWeb 没有官方公共实例。即使后端不能解密 Apple 流量，恶意部署者仍可篡改前端 JavaScript，在加密前窃取凭据。不要盲目信任公共实例，优先自行部署，并检查域名和 TLS 证书。

## Apple 服务兼容性

Apple 可能随时调整接口地址和重定向行为。当前版本通过以下方式降低接口变化造成的故障：

- 请求 `init.itunes.apple.com/bag.xml?ix=6` 获取当前服务配置
- 动态读取 `authenticateAccount` 和 `redownloadProduct`
- 严格验证下载端点必须使用 HTTPS 和 Apple 指定主机
- Native 认证端点返回异常重定向、空响应或 HTML 时，仅回退一次旧认证端点
- 统一处理 `301`、`302`、`303`、`307`、`308`
- 对非 Plist 响应记录脱敏诊断信息，不记录凭据、Cookie 或 Token

`HTTP 429` 表示 Apple 正在限制账号或出口 IP。程序不会自动重试或回退，因为反复请求只会让限制更严重。遇到该状态时应停止尝试，等待一段时间后再测试。

## 快速部署

### 使用 Docker Compose

```bash
git clone https://github.com/Jinn-Y/AssppWeb.git
cd AssppWeb
git switch release
docker compose up -d
```

`compose.yml` 会从当前检出的源码构建本地镜像 `assppweb:local`。其中 `pull_policy: build` 会要求 Compose 在执行 `docker compose up -d` 时重新运行构建，即使本地已经存在同名镜像。

以后更新只需要：

```bash
git pull
docker compose up -d
```

Docker BuildKit 会复用未变化的构建层；只有依赖锁文件变化时，才需要重新执行对应的 `npm ci` 层。

### 构建当前源码

如果不使用 Compose，可以手动构建和运行：

```bash
docker build -t assppweb:local .
docker run --rm -p 8080:8080 \
  -v "$(pwd)/mnt/asspp-data:/data" \
  -e DATA_DIR=/data \
  assppweb:local
```

持久化数据会保存在 `./mnt/asspp-data`。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 后端监听端口 |
| `DATA_DIR` | `./data` | IPA 与任务数据目录 |
| `PUBLIC_BASE_URL` | 自动判断 | 生成安装清单时使用的公网地址 |
| `UNSAFE_DANGEROUSLY_DISABLE_HTTPS_REDIRECT` | `false` | 禁止后端 HTTP 到 HTTPS 重定向 |
| `AUTO_CLEANUP_DAYS` | `0` | 删除超过指定天数的缓存 IPA，`0` 表示关闭 |
| `AUTO_CLEANUP_MAX_MB` | `0` | 缓存超过指定容量时删除最旧文件，`0` 表示关闭 |
| `MAX_DOWNLOAD_MB` | `0` | IPA 最大下载体积，`0` 表示不限制 |
| `DOWNLOAD_THREADS` | `8` | IPA 并行下载线程数，范围 `1–32` |
| `ACCESS_PASSWORD` | 空 | Web 页面与 API 的访问密码 |

## 本地开发

要求：

- Node.js 20 或更高版本
- npm

启动后端：

```bash
cd backend
npm ci
UNSAFE_DANGEROUSLY_DISABLE_HTTPS_REDIRECT=true npm run dev
```

另开一个终端启动前端：

```bash
cd frontend
npm ci
npm run dev
```

Vite 默认将 `/api` 和 `/wisp` 转发到 `localhost:8080`。如果 Windows 报告 Vite 端口 `EACCES`，先检查系统保留端口：

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
npm run dev -- --port 4173
```

## 反向代理

iOS 的 `itms-services://` 安装链接要求 HTTPS，因此公网部署必须配置有效 TLS 证书。Caddy 示例：

```caddy
asspp.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

必须允许 `/wisp/` 的 WebSocket Upgrade，否则页面能够打开，但浏览器无法通过 Wisp 连接 Apple。

如果反向代理错误地发送 `X-Forwarded-Proto: http`，可能出现无限重定向。优先修正代理头；只有在外层已经强制 HTTPS 时，才能设置：

```env
UNSAFE_DANGEROUSLY_DISABLE_HTTPS_REDIRECT=true
```

## 常见故障

### 无法获取认证重定向地址

先查看浏览器错误信息：

- `301/302/...` 且没有 `Location`：Apple Native 认证响应异常，当前版本会自动回退旧端点。
- `429`：账号或出口 IP 被限流，应立即停止重复登录。
- 返回 HTML：通常是 Apple 边缘节点、代理或认证端点异常。

再检查服务器网络：

```bash
getent ahosts auth.itunes.apple.com
timeout 10 bash -c '</dev/tcp/auth.itunes.apple.com/443'
openssl s_client \
  -connect auth.itunes.apple.com:443 \
  -servername auth.itunes.apple.com \
  -tls1_3 </dev/null
```

TCP 和 TLS 都成功并不能证明认证业务成功，只能排除 DNS、端口和 TLS 握手故障。

### Wisp 已连接但认证卡住

- 确认反向代理支持 WebSocket。
- 确认服务器允许访问 Apple TCP 443。
- 检查后端日志是否出现目标主机被白名单拒绝。
- 不要在后端记录或抓取 TLS 明文；该项目的安全边界就是浏览器端 TLS。

### Docker 重启后修复未生效

先执行 `git log -1 --oneline` 确认源码已经更新，再执行 `docker compose up -d`。当前 Compose 配置会强制走本地构建；如果使用了其他 Compose 文件或执行时带有 `--no-build`，则不会生成新镜像。

## 测试

```bash
cd backend
npx vitest run
npm run build
```

```bash
cd frontend
npx vitest run
npm run build
```

完整 Docker E2E：

```bash
bash e2e/docker-test.sh
```

测试账号必须通过 `TEST_EMAIL`、`TEST_PASSWORD`、`TEST_DEVICE_ID` 和 `TEST_BUNDLE_ID` 等环境变量提供，禁止提交到仓库。

## 安全建议

- 优先自行部署，不要将 Apple ID 输入来源不明的公共实例。
- 公网实例应放在 CDN 或具备流量限制的反向代理之后。
- `ACCESS_PASSWORD` 只能限制页面访问，不会把后端变成 Apple 凭据代理。
- 不要在日志中输出请求体、Cookie、密码令牌或完整 Plist。

## 更新记录

参见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

本项目使用 MIT License，详见 [LICENSE](LICENSE)。

## 致谢

重要参考项目：

- [ipatool](https://github.com/majd/ipatool)
- [Asspp](https://github.com/Lakr233/Asspp)

测试与反馈：

- [@lbr77](https://github.com/lbr77)
- [@akinazuki](https://github.com/akinazuki)

<img src="./Artworks/fable5.jpg" alt="Fable 5 Verified" width="240">
