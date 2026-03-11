# MFA Auth 插件 - 移除认证成功主动推送实施计划

## 需求描述
- 去除**前端认证页面**认证成功后的服务器端主动推送
- 保留**聊天侧轮询**检测到认证成功后的通知
- 只保留 `enableAuthNotification=false` 的情况
- `enableAuthNotification` 固定为 `false`

## 当前架构分析

### 认证成功通知的两种来源

1. **前端认证页面的服务器端推送** (需要删除)
   - `setNotifyCallback` 回调函数 (`index.ts:49-92`) - 认证页面认证成功后由 server 调用
   - `before_tool_call` 拦截器 (`index.ts:161-186`) - 二次认证场景，用户已认证时立即发送通知
   - `message_received` 拦截器 (`index.ts:340-369`) - 首次消息认证场景，用户已认证时立即发送通知
   - 这类通知依赖 `enableAuthNotification` 配置

2. **聊天侧轮询通知** (需要保留)
   - `startPollingForAuth` 函数 (`index.ts:609-680`) - 聊天侧每2秒轮询认证状态
   - 检测到认证成功后主动发送通知
   - 用于 `enableAuthNotification=false` 的情况
   - 使用 `checkAndConsumeNotification` 避免重复通知

### 需要保留的相关数据结构

- `NotificationInfo` 接口 (`auth-manager.ts:9-12`) - 存储通知上下文
- `pendingNotifications` Map (`auth-manager.ts:18`) - 待发送通知队列
- `checkAndConsumeNotification` 方法 (`auth-manager.ts:244-251`) - 原子性消费通知

## 实施步骤

### 步骤 1: 固定 `enableAuthNotification` 为 `false`
**文件**: `src/config.ts`

```typescript
// 修改前
enableAuthNotification: parseBooleanEnv(process.env.MFA_ENABLE_AUTH_NOTIFICATION) ?? false,

// 修改后
enableAuthNotification: false,
```

### 步骤 2: 删除 `setNotifyCallback` 回调函数
**文件**: `index.ts`

删除第 49-92 行的 `setNotifyCallback` 调用及其整个回调函数：

```typescript
// 删除整个块
setNotifyCallback(async (session: AuthSession) => {
  api.logger.info(`[mfa-auth] User ${session.userId} verified`);

  if (!config.enableAuthNotification) {
    api.logger.info(`[mfa-auth] Auth notification disabled, skipping message send.`);
    return;
  }

  try {
    const commandBody = session.originalContext.commandBody;
    const triggerType = session.originalContext.triggerType || "sensitive_operation";

    const isFirstMessageAuth = triggerType === "first_message";
    const isReauth = commandBody.trim() === "/reauth";

    let messageText = "";
    if (isFirstMessageAuth) {
      messageText = isReauth
        ? `🎉 重新认证成功！请重新发送消息以继续对话。`
        : `🎉 首次认证成功！请重新发送消息以继续对话。`;
    } else {
      messageText = `✅ 二次认证成功！\n\n请回到聊天窗口，重新发送之前的命令（或回复'确认'）即可执行。`;
    }

    const channel = session.originalContext.channel;
    const sessionKey =
      session.originalContext.sessionKey ||
      `${channel}:${session.originalContext.accountId || ""}:${session.userId}`;

    api.logger.info(`[mfa-auth] Sending notification to session: ${sessionKey}`);

    await sendAuthMessage(
      channel,
      session.originalContext.accountId,
      session.originalContext.to || session.userId,
      messageText,
      session.userId,
      sessionKey,
    );
    api.logger.info(`[mfa-auth] Notification sent to user ${session.userId}`);
  } catch (error) {
    api.logger.error(`[mfa-auth] Failed in notify callback: ${String(error)}`);
  }
});
```

### 步骤 3: 删除 `before_tool_call` 中的即时通知
**文件**: `index.ts`

删除第 161-186 行的即时通知逻辑：

```typescript
// 删除
const notificationInfo = authManager.checkAndConsumeNotification(userId);
if (notificationInfo) {
  const sessionKey = ctx.sessionKey || "";
  const sessionKeyParts = sessionKey.split(":").filter(Boolean);
  const parsedChannel = sessionKeyParts[2] || undefined;
  let parsedAccountId = sessionKeyParts[3] || undefined;
  const parsedTo = sessionKeyParts[sessionKeyParts.length - 1] || undefined;

  if (parsedAccountId === "direct" || parsedAccountId === "group") {
    parsedAccountId = undefined;
  }

  const targetSessionKey =
    parsedChannel === "webchat" || parsedChannel === "web" ? userId : sessionKey;

  sendAuthMessage(
    parsedChannel,
    parsedAccountId,
    parsedTo || userId,
    "✅ 二次认证成功，请重新发送之前的命令（或回复'确认'）即可执行。",
    userId,
    targetSessionKey,
  ).catch((err) =>
    api.logger.error(`[mfa-auth] Failed to send success notification: ${err}`),
  );
}
```

保留 `return undefined;`，让已认证用户的操作继续执行。

### 步骤 4: 删除 `message_received` 中的即时通知
**文件**: `index.ts`

删除第 340-369 行的即时通知逻辑：

```typescript
// 删除
const notificationInfo = authManager.checkAndConsumeNotification(userId);
if (notificationInfo) {
  const parsedChannel = ctx.channelId;
  const parsedAccountId = ctx.accountId || "";
  const parsedTo = event.from;

  let sessionKey = ctx.conversationId;
  if (!sessionKey) {
    if (parsedChannel === "webchat" || parsedChannel === "web") {
      sessionKey = userId;
    } else {
      sessionKey = `${parsedChannel}:${parsedAccountId}:${event.from}`;
    }
  }

  const messageText = notificationInfo.isReauth
    ? "✅ 重新认证成功，请继续对话。"
    : "✅ 首次认证成功，请继续对话。";

  sendAuthMessage(
    parsedChannel,
    parsedAccountId,
    parsedTo || userId,
    messageText,
    userId,
    sessionKey,
  ).catch((err) =>
    api.logger.error(`[mfa-auth] Failed to send success notification: ${err}`),
  );
}
```

保留 `return;`，让已认证用户的消息继续处理。

### 步骤 5: 保留 `startPollingForAuth` 函数及其通知发送
**文件**: `index.ts`

**完全保留 `startPollingForAuth` 函数**，该函数用于：
- 聊天侧每2秒轮询认证状态
- 检测到认证成功后主动发送通知
- 使用 `checkAndConsumeNotification` 避免重复通知
- 超时后停止轮询

此函数无需修改，保持原样即可。

  ### 步骤 6: 保留 `NotificationInfo` 相关代码
  **文件**: `src/auth-manager.ts`

  由于 `startPollingForAuth` 函数需要使用以下代码，**保留不删**：
  - `NotificationInfo` 接口
  - `pendingNotifications` Map
  - `checkAndConsumeNotification` 方法
  - `markUserVerified` 方法中的 `pendingNotifications.set`

  ### 步骤 7: 更新 `types.ts`
  **文件**: `src/types.ts`

  删除 `enableAuthNotification` 字段 (第 50 行)：

  ```typescript
  // 删除
  enableAuthNotification?: boolean;
  ```

## 验证清单

- [ ] `config.ts` 中 `enableAuthNotification` 固定为 `false`
- [ ] `index.ts` 中 `setNotifyCallback` 回调已删除
- [ ] `index.ts` 中 `before_tool_call` 的即时通知逻辑已删除
- [ ] `index.ts` 中 `message_received` 的即时通知逻辑已删除
- [ ] `index.ts` 中 `startPollingForAuth` 函数保持不变（包含通知发送）
- [ ] `auth-manager.ts` 中 `NotificationInfo` 接口保留
- [ ] `auth-manager.ts` 中 `pendingNotifications` Map 保留
- [ ] `auth-manager.ts` 中 `checkAndConsumeNotification` 方法保留
- [ ] `auth-manager.ts` 中 `markUserVerified` 方法的 `pendingNotifications.set` 保留
- [ ] `types.ts` 中 `enableAuthNotification` 字段已删除

## 预期结果

实施后，认证成功的流程将变为：

### 删除的通知机制（前端认证页面的服务器端推送）
1. 用户在认证页面扫描二维码完成认证
2. 前端页面显示认证成功状态
3. ~~服务器端通过 `setNotifyCallback` 推送消息到聊天窗口~~（已删除）
4. ~~拦截器检测到用户已认证时立即发送通知~~（已删除）

### 保留的通知机制（聊天侧轮询）
1. 用户在聊天窗口收到认证链接
2. `startPollingForAuth` 函数每2秒轮询认证状态
3. 检测到认证成功后，主动推送成功消息到聊天窗口
4. 消息内容包括：
   - ✅ 首次认证成功，请继续对话。
   - ✅ 重新认证成功，请继续对话。
   - ✅ 二次认证成功，请重新发送之前的命令（或回复'确认'）即可执行。

### 总结
- **删除**：前端认证页面认证成功后的服务器端主动推送
- **保留**：聊天侧轮询检测到认证成功后的通知
- **保留**：认证前的请求消息（发送认证链接）
- **保留**：前端页面的认证成功显示
- **保留**：内部的认证状态管理（用于后续拦截判断）
