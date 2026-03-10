# MFA Auth 插件：分离式部署指南

## 概述

本指南介绍如何将 MFA Auth 插件部署在"分离式"模式下，即：

- **前端页面**（认证页面）部署在外网服务器（如 Nginx、Vercel）
- **后端服务**（OpenClaw）运行在本地计算机

这种方式特别适合以下场景：
- OpenClaw 本地运行，但需要在外网访问认证页面
- 不想使用内网穿透工具（如 frp、ngrok）
- 认证页面需要部署在 CDN 或静态网站托管服务上

## 工作原理

### 传统模式 vs 分离式模式

**传统模式（集成部署）**：
```
前端页面 <---> 本地 HTTP 服务 (端口 18801)
    |
    +--> 轮询 /mfa-auth/verify 检查状态
```

**分离式模式（本方案）**：
```
外网静态页面 (Nginx/CDN)
    |
    +--> 展示二维码 (无需轮询)
    
本地 OpenClaw
    |
    +--> 后端轮询 Dabby API
    +--> 认证成功后推送飞书通知
```

### 关键机制

1. **后端轮询**：OpenClaw 在生成认证会话后，自动启动定时器（每 2 秒）查询 Dabby API，直到认证成功或超时
2. **静态页面**：前端页面只负责展示二维码，不再轮询后端接口
3. **结果推送**：认证成功后，OpenClaw 通过飞书通知用户

## 前置条件

- 已配置好 Dabby 账号（`DABBY_CLIENT_ID` 和 `DABBY_CLIENT_SECRET`）
- 已配置好飞书通知（参见 [README.md](./README.md)）
- 有一个外网可访问的 Web 服务器（Nginx、Apache、Vercel 等）

## 部署步骤

### 1. 部署静态认证页面

#### 1.1 获取静态页面文件

静态页面文件位于插件目录：
```
extensions/mfa-auth/public/auth.html
```

#### 1.2 部署到 Nginx

将 `auth.html` 上传到你的 Web 服务器，例如：

```bash
# 上传到服务器
scp extensions/mfa-auth/public/auth.html user@your-server:/var/www/html/auth/

# 配置 Nginx
server {
    listen 80;
    server_name auth.example.com;

    location /auth/ {
        alias /var/www/html/auth/;
        index auth.html;
    }
}
```

访问地址示例：
```
http://auth.example.com/auth/auth.html?code=二维码内容
```

#### 1.3 部署到 Vercel (或其他静态托管)

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel --prod extensions/mfa-auth/public
```

Vercel 会提供一个 HTTPS URL，例如：
```
https://your-project.vercel.app/auth.html?code=二维码内容
```

### 2. 配置本地 OpenClaw

#### 2.1 设置环境变量

在 OpenClaw 的 `.env` 文件中添加以下配置：

```bash
# 启用后端轮询模式
MFA_ENABLE_BACKEND_POLLING=true

# 设置外网认证页面 URL（必须包含 auth.html 的完整路径）
MFA_AUTH_PAGE_URL=https://auth.example.com/auth/auth.html

# Dabby 配置
DABBY_CLIENT_ID=your_client_id_here
DABBY_CLIENT_SECRET=your_client_secret_here

# 飞书配置（如需飞书通知）
FEISHU_APP_ID=your_feishu_app_id
FEISHU_APP_SECRET=your_feishu_app_secret
```

**重要说明**：
- `MFA_ENABLE_BACKEND_POLLING=true` 启用后端自动轮询
- `MFA_AUTH_PAGE_URL` 必须指向你部署的静态 `auth.html` 文件
- `MFA_AUTH_PAGE_URL` 会覆盖默认的本地 URL 生成逻辑

#### 2.2 禁用 HTTP 服务器（可选）

在分离式模式下，OpenClaw 本地不再需要启动 HTTP 服务器（因为前端页面已外网部署），但为了兼容性，服务器仍会启动。你可以忽略本地服务器的日志。

### 3. 验证部署

#### 3.1 测试静态页面

直接访问外网 URL，确保二维码能正常渲染：

```
https://auth.example.com/auth/auth.html?code=测试二维码内容
```

应该能看到二维码图片展示。

#### 3.2 触发认证流程

在飞书中发送一条消息（或执行敏感操作），OpenClaw 应该返回外网链接：

> 🔒 **身份验证请求**
>
> 为了保障安全，首次对话需要进行实名认证。请点击链接完成验证：
> https://auth.example.com/auth/auth.html?code=dabby_二维码内容
>
> 验证有效期: 5 分钟

#### 3.3 完成认证

1. 点击外网链接，打开静态页面
2. 使用手机扫描二维码
3. 在手机上完成认证

#### 3.4 检查飞书通知

认证成功后，你应该在飞书收到通知：

> 🎉 认证成功！
>
> 您的身份验证已完成，可以继续使用 OpenClaw。

### 4. 查看后端轮询日志

如果启用了 `debug` 模式（默认启用），你可以在 OpenClaw 日志中看到轮询信息：

```
[mfa-auth] Started backend polling for session: xxx-xxx-xxx
[mfa-auth] Backend polling: Session verified: xxx-xxx-xxx
[mfa-auth] User user_id marked as verified (sensitive_operation)
[mfa-auth] Stopped backend polling for session: xxx-xxx-xxx
```

## 配置参考

### 环境变量完整列表

| 变量名                      | 必填 | 描述                                    | 默认值       |
| :-------------------------- | :--- | :-------------------------------------- | :----------- |
| `MFA_ENABLE_BACKEND_POLLING` | 是   | 启用后端轮询（分离式部署必须启用）      | `false`      |
| `MFA_AUTH_PAGE_URL`          | 是   | 外网认证页面完整 URL                    | 无           |
| `DABBY_CLIENT_ID`            | 是   | Dabby 平台 Client ID                   | 无           |
| `DABBY_CLIENT_SECRET`        | 是   | Dabby 平台 Client Secret               | 无           |
| `MFA_SENSITIVE_KEYWORDS`      | 否   | 敏感关键词列表                          | 内置列表     |
| `MFA_REQUIRE_AUTH_ON_SENSITIVE_OPERATION` | 否 | 启用敏感操作二次认证 | `true` |
| `MFA_VERIFICATION_DURATION`   | 否   | 敏感操作验证有效期（毫秒）              | `120000`     |
| `MFA_REQUIRE_AUTH_ON_FIRST_MESSAGE` | 否 | 启用首次对话认证 | `false` |
| `MFA_FIRST_MESSAGE_AUTH_DURATION` | 否 | 首次认证有效期（毫秒） | `86400000` |

### .env 示例文件

```bash
# --- MFA 认证扩展配置（分离式部署模式）---

# 启用后端轮询（分离式部署必须）
MFA_ENABLE_BACKEND_POLLING=true

# 外网认证页面 URL
MFA_AUTH_PAGE_URL=https://auth.example.com/auth/auth.html

# Dabby (大白) 实名认证账号
DABBY_CLIENT_ID=your_client_id_here
DABBY_CLIENT_SECRET=your_client_secret_here

# 敏感操作关键词
MFA_SENSITIVE_KEYWORDS=delete,remove,rm,unlink,rmdir,format,wipe,erase,exec,eval,system,shell,bash,sudo,su,chmod,chown,restart,shutdown,reboot,gateway,kill,stop,drop,truncate

# 首次认证配置
MFA_REQUIRE_AUTH_ON_FIRST_MESSAGE=true
MFA_FIRST_MESSAGE_AUTH_DURATION=86400000

# 二次认证配置
MFA_REQUIRE_AUTH_ON_SENSITIVE_OPERATION=true
MFA_VERIFICATION_DURATION=120000

# 存储路径
MFA_AUTH_STATE_DIR=~/.openclaw/mfa-auth/
```

## 常见问题

### 1. 为什么点击链接后页面显示"缺少二维码参数"？

**原因**：URL 中没有 `code` 参数，或 `MFA_AUTH_PAGE_URL` 配置错误。

**解决**：
- 检查 `MFA_AUTH_PAGE_URL` 是否完整且可访问
- 检查 OpenClaw 日志中生成的链接是否包含 `code` 参数

### 2. 认证成功后没有收到飞书通知？

**可能原因**：
1. 后端轮询未启用（检查 `MFA_ENABLE_BACKEND_POLLING=true`）
2. 飞书配置错误（检查 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`）
3. 认证超时（默认 5 分钟）

**排查步骤**：
1. 查看日志中是否有 `Backend polling: Session verified` 消息
2. 检查飞书应用是否有发送消息权限
3. 确认飞书接收者的 user_id 格式正确

### 3. 后端轮询会导致性能问题吗？

**不会**。轮询仅在会话生成后启动，认证成功或超时后立即停止。每个会话独立轮询，默认间隔 2 秒，不会造成明显性能影响。

### 4. 能否同时使用传统模式和分离式模式？

**不能**。必须选择其中一种模式：

- **传统模式**：不设置 `MFA_ENABLE_BACKEND_POLLING`，使用本地 HTTP 服务器
- **分离式模式**：设置 `MFA_ENABLE_BACKEND_POLLING=true` 和 `MFA_AUTH_PAGE_URL`

### 5. 静态页面需要后端支持吗？

**不需要**。`auth.html` 是纯静态页面，使用 CDN 托管的 `qrcode.js` 在浏览器端生成二维码，无需任何后端支持。

### 6. 如何更新静态页面？

只需替换 Web 服务器上的 `auth.html` 文件，无需重启 OpenClaw。

## 高级配置

### 自定义静态页面样式

你可以修改 `auth.html` 中的 CSS 来自定义页面样式，例如修改主题色、布局等。

### 使用 CDN 加速 qrcode.js

`auth.html` 默认使用 jsDelivr CDN。你可以替换为其他 CDN 或本地文件：

```html
<!-- 使用国内 CDN -->
<script src="https://cdn.baomitu.com/qrcode/1.5.3/qrcode.min.js"></script>

<!-- 或使用本地文件 -->
<script src="/static/qrcode.min.js"></script>
```

### 多域名部署

如果你有多个域名，可以为每个域名配置不同的 `MFA_AUTH_PAGE_URL`，只需在启动 OpenClaw 时指定不同的环境变量即可。

## 安全建议

1. **HTTPS**：强烈建议为认证页面启用 HTTPS，防止中间人攻击
2. **防盗链**：可以在 Nginx 中配置 Referer 检查，防止其他网站盗用
3. **有效期控制**：合理设置 `MFA_VERIFICATION_DURATION`，避免过长的认证有效期
4. **访问日志**：定期检查认证页面的访问日志，发现异常访问及时处理

## 回退到传统模式

如果分离式模式遇到问题，可以随时回退到传统模式：

1. 移除 `MFA_ENABLE_BACKEND_POLLING=true`
2. 移除 `MFA_AUTH_PAGE_URL`
3. 配置 `MFA_AUTH_DOMAIN`（如果使用 Nginx 反向代理）
4. 确保 OpenClaw 本地 HTTP 服务器可访问（端口 18801）

## 技术支持

如有问题，请提交 Issue 或联系开发团队。
