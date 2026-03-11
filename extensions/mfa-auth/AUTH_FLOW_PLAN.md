# MFA Auth 插件认证流程说明

## 1. 认证链接生成

### 链接格式
```
http://10.30.1.53:18801/mfa-auth/{sessionId}
```

### 生成位置
- **文件**: `extensions/mfa-auth/src/server.ts`
- **函数**: `startHttpServer()` (第 33-234 行)
- **路由**: `GET /mfa-auth/:sessionId` (第 135-216 行)

### 生成流程
```typescript
// 1. 解析 sessionId
const sessionId = url.pathname.split("/")[2];

// 2. 从 authManager 获取 session
const session = authManager.getSession(sessionId);

// 3. 初始化认证 provider
const provider = authManager.getProvider(session.authMethod);
await provider.initialize(session);

// 4. 生成认证页面
const authUrl = `${getServerBaseUrl()}/mfa-auth/${session.sessionId}`;
const html = await provider.generateAuthPage(session, authUrl);
```

### 调用链路
```
用户访问链接 → HTTP Server → authManager.getSession()
             → provider.initialize() → dabbyClient.getQrCode()
             → provider.generateAuthPage() → 返回 HTML 页面
```

---

## 2. getAuthResult 方法

### 位置
- **文件**: `extensions/mfa-auth/src/dabby-client.ts`
- **函数**: `getAuthResult(certToken: string)` (第 124-175 行)

### 功能
调用 Dabby API 的 `/authhist` 接口查询认证结果

### 请求参数
```typescript
{
  accessToken: string,  // 从缓存或刷新获取
  authHistQry: {
    certToken: string    // 会话的认证令牌
  }
}
```

### 返回值
```typescript
{
  status: "pending" | "verified" | "failed" | "expired",
  error?: string,
  authObject?: {
    idNum: string,
    fullName: string
  }
}
```

### 状态说明
- **pending**: 认证进行中 (retCode = 4401)
- **verified**: 认证成功 (resCode = 0)
- **failed**: 认证失败 (resCode != 0)
- **expired**: 超时

### 调用时机
在 `extensions/mfa-auth/src/providers/qr-code.ts` 的 `verify()` 方法中被调用 (第 46 行)

---

## 3. /authhist 接口

### 接口信息
- **URL**: `{apiBaseUrl}/authhist`
- **方法**: POST
- **Content-Type**: application/json

### 请求示例
```json
{
  "accessToken": "your-access-token",
  "authHistQry": {
    "certToken": "cert-token-from-qrcode"
  }
}
```

### 响应示例
```json
{
  "retCode": 0,
  "retMessage": "success",
  "authData": {
    "resCode": 0,
    "authObject": {
      "idNum": "身份证号",
      "fullName": "姓名"
    }
  }
}
```

### 特殊状态码
- **4401**: 该 certToken 未进行认证 → 返回 `status: "pending"`，继续轮询
- **其他错误**: 抛出异常

---

## 4. 认证成功后的消息推送流程

### 完整流程图
```
用户扫码
  ↓
Dabby 系统记录认证结果
  ↓
前端轮询 /mfa-auth/verify
  ↓
server.ts: /mfa-auth/verify 接口
  ↓
authManager.verifySession(sessionId)
  ↓
provider.verify() → dabbyClient.getAuthResult(certToken)
  ↓
认证成功 (status === "verified")
  ↓
触发 notifyCallback(session)
  ↓
index.ts: setNotifyCallback 回调 (第 49-87 行)
  ↓
sendAuthMessage() → notificationService.sendAuthNotification()
  ↓
根据渠道分发消息
  ├─ web/webchat → sendToWebChat() → WebSocket 推送
  └─ feishu → sendToFeishu() → 飞书 API 推送
```

### 关键代码位置

#### 1. verify 接口触发回调
**文件**: `extensions/mfa-auth/src/server.ts` (第 47-79 行)
```typescript
if (url.pathname === "/mfa-auth/verify") {
  const result = await authManager.verifySession(sessionId);
  if (result.success) {
    if (notifyCallback) {
      await notifyCallback(session);  // 触发回调
    }
  }
}
```

#### 2. 认证成功回调
**文件**: `extensions/mfa-auth/index.ts` (第 49-87 行)
```typescript
setNotifyCallback(async (session: AuthSession) => {
  const messageText = isFirstMessageAuth
    ? `🎉 首次认证成功！请重新发送消息以继续对话。`
    : `✅ 二次认证成功！\n\n请回到聊天窗口，重新发送之前的命令（或回复'确认'）即可执行。`;

  await sendAuthMessage(
    channel,
    session.originalContext.accountId,
    session.originalContext.to || session.userId,
    messageText,
    session.userId,
    sessionKey,
  );
});
```

#### 3. 飞书消息发送
**文件**: `extensions/mfa-auth/src/notification-service.ts` (第 266-314 行)
```typescript
private async sendToFeishu(session: AuthSession, message: string): Promise<void> {
  const { client, receiveId, receiveIdType } = resolveFeishuSendTarget({
    cfg: this.cfg,
    to,
    accountId,
  });

  const { content, msgType } = this.buildFeishuPostMessagePayload({ messageText });

  await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: msgType,
    },
  });
}
```

---

## 5. 支持的渠道

当前支持的认证通知渠道：

| 渠道 | 标识 | 实现位置 | 发送方式 |
|------|------|----------|----------|
| Web/WebChat | `web`, `webchat` | `sendToWebChat()` | WebSocket |
| 飞书 | `feishu` | `sendToFeishu()` | 飞书 API |

### Web/WebChat 渠道
- 通过 WebSocket 连接到 Gateway
- 使用 `chat.inject` 方法注入消息
- 支持多 session key 匹配（精确匹配、模糊匹配）

### 飞书渠道
- 使用 `@larksuiteoapi/node-sdk` SDK
- 消息类型: `post` (富文本)
- 支持 Markdown 格式

---

## 6. 配置项

### server.ts 配置
- `config.port`: HTTP 服务端口 (默认 18801)
- `config.domain`: 自定义域名 (可选，用于生成链接)
- `config.timeout`: 认证超时时间 (毫秒)

### notification-service.ts 配置
- `config.gatewayHost`: Gateway 主机地址 (默认 127.0.0.1)
- `cfg.gateway.port`: Gateway WebSocket 端口 (默认 18789)
- `cfg.gateway.auth.token`: Gateway 认证 Token (可选)

---

## 7. 时序图

```
用户                MFA Server              Dabby API              飞书
 |                       |                        |                    |
 |-- 访问 /mfa-auth/xxx -->|                        |                    |
 |<----- 返回 QR 码页面 -----|                        |                    |
 |                       |                        |                    |
 |-- 扫码认证 ---------->|-------- /authreq ------->|                    |
 |                       |<------ QR 码信息 --------|                    |
 |                       |                        |                    |
 |<----- 显示 QR 码 -----|                        |                    |
 |                       |                        |                    |
 |                       |---- /authhist 轮询 --->|                    |
 |                       |<---- pending 状态 ------|                    |
 |                       |                        |                    |
 |                       |---- /authhist 轮询 --->|                    |
 |                       |<---- verified 状态 ----|                    |
 |                       |                        |                    |
 |                       |-- 认证成功通知 -------->-------------------->|
 |<----- 推送成功消息 -----|                        |                    |
```

---

## 8. 文件结构

```
extensions/mfa-auth/
├── index.ts                    # 插件入口，注册事件和回调
├── src/
│   ├── server.ts               # HTTP 服务器，处理认证链接和轮询
│   ├── dabby-client.ts         # Dabby API 客户端，包含 getAuthResult
│   ├── providers/
│   │   └── qr-code.ts         # 二维码认证 provider
│   ├── auth-manager.ts         # 认证会话管理
│   ├── notification-service.ts # 消息推送服务
│   └── types.ts                # 类型定义
```

---

## 9. 关键依赖

- **@larksuiteoapi/node-sdk**: 飞书 API SDK
- **openclaw/plugin-sdk**: OpenClaw 插件 SDK
- **qrcode**: 二维码生成库

---

## 10. 扩展新渠道

如需添加新的消息渠道支持：

1. 在 `notification-service.ts` 的 `sendAuthNotification()` 中添加新的渠道判断
2. 实现对应的发送方法（如 `sendToNewChannel()`）
3. 在 `index.ts` 中确保正确传递 `channel`、`accountId`、`to` 等参数

---

**文档版本**: 1.0
**最后更新**: 2026-03-11
