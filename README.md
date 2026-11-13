# 微趣 · AI 表情工作台

面向微信表情创作者的本地工作台。当前版本围绕“静态图确认后才调用动态图模型”的流程构建，并提供 OpenAI 兼容接口的多渠道管理。

## 已实现

- 创作工作台：6 帧挥手分镜、静态版本确认门禁、动态图任务状态和微信规范预检
- 模型渠道：多渠道、自动读取 `/models`、完整保存每个渠道的模型清单
- 默认设置：从所有渠道的模型中分别选择数据分析、静态图生成、动态图生成默认模型
- 数据分析：调用量、成功率、耗时、费用和最近任务活动
- 本地保存：渠道配置和默认模型保存在浏览器 `localStorage`
- OpenAI 兼容客户端：`src/services/openaiCompatible.ts` 和 `server.mjs` 提供 `/models`、`/chat/completions`、`/images/generations`、`/videos` 四类请求封装
- 动态 GIF：动态图模型直接返回 GIF，前端保留原始响应并提供预览和下载
- 图像定位：`locate.py` 使用 OpenCV 检测主体边界、中心和脚底线，在动态图模型调用前提供定位约束
- 实时统计：本地服务保存最近 300 条任务事件，数据分析页优先读取真实事件
- 管理员账户设置：修改显示名称、登录邮箱和密码；修改密码会撤销其他会话并为当前浏览器续签

## 启动

```bash
npm install
npm run dev
```

打开 `http://localhost:5173/`。

## 公网后台登录

公网部署不能继续使用纯浏览器本地存储和匿名接口。当前版本已加入单管理员服务端登录：未登录时只能看到登录页，模型渠道、任务、素材和统计接口都会返回 `401`。会话使用 HttpOnly Cookie 保存，密码只在服务端校验，不会进入前端代码。

生产环境启动前必须设置环境变量：

```text
NODE_ENV=production
STICKER_ADMIN_EMAIL=admin@example.com
STICKER_ADMIN_PASSWORD=请替换为长随机密码
STICKER_DB_PATH=./data/sticker.sqlite
STICKER_WEB_ORIGIN=https://你的域名
STICKER_SECURE_COOKIE=1
```

可以复制 `.env.example` 作为配置模板。首次启动会创建 `data/sticker.sqlite`，管理员账号只会初始化一次；不要把 `.env` 或 `data/` 提交到版本库。登录后可以在“默认设置 → 管理员账户”修改显示名称、登录邮箱和密码；修改密码必须填写当前密码，成功后其他设备会退出登录。公网必须使用 HTTPS，并在反向代理层限制只转发到应用端口。

开发环境如果没有设置密码，服务会生成一次性开发管理员密码并打印到启动控制台。当前鉴权底座使用 Node 22.5+ 的 SQLite API；生产环境下一阶段会把业务数据（渠道、项目、任务、素材和用量）继续迁移到服务端数据库和对象存储，浏览器 IndexedDB 只保留缓存。

`npm run dev` 会跨平台并行启动本地任务代理（`http://localhost:8787`）和 Vite（`http://localhost:5173`），负责外部模型请求、任务记录和图像定位。动态图模型返回的 GIF 会直接交给前端预览和下载。

## 三类模型角色

1. **数据分析**：提示词拆解、角色特征提取、定位结果分析和质量报告。
2. **静态图生成**：角色原型、九宫格、六帧动作分镜和静态素材。
3. **动态图生成**：连续帧、短视频或 GIF。只有静态版本状态为 `approved` 时才会进入任务队列。

## 两种制作模式

- **单个表情**：一个动作或情绪对应一个素材，确认静态图后可调用动态图模型生成一个 GIF。
- **套图表情包**：规划 8～24 个表情，先锁定角色和风格，再按每个表情建立独立任务，支持批量生成和逐项结果。

制作模式和输出类型分开保存：制作模式决定项目任务结构，输出类型决定生成静态图还是动态图。

## OpenAI 兼容渠道

在“模型渠道”中填写渠道 Base URL、API Key 和三个模型 ID。默认实现按以下路径请求：

```text
GET  {baseUrl}/models
POST {baseUrl}/chat/completions
POST {baseUrl}/images/generations
POST {baseUrl}/videos
```

不同动态图服务商的字段存在差异时，在 `server.mjs` 的 `/api/ai/motion` 中增加适配字段即可。真实 API Key 只从浏览器传到本机代理，再由代理发送给配置的渠道；不要提交到版本库。生产环境建议继续使用 Tauri 安全存储。

## 构建检查

```bash
npm run build
```
