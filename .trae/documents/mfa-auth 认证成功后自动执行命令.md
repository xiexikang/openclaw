# mfa-auth 二次认证成功后自动执行命令（方案B）

## 需求

用户二次认证成功后，无需重新发送命令，系统自动执行被拦截的操作。

## 实现方案

### 核心思路

在认证成功回调中，通过 `api.runtime` 发送特殊格式的消息，触发 agent 重新执行被拦截的命令。

### 修改文件清单

#### 1. 修改 `src/types.ts`

- 在 `PendingAuthContext` 中添加 `pendingExecutionId` 字段（用于追踪待执行）

#### 2. 修改 `src/auth-manager.ts`

- 添加 `getAndClearPendingExecution(userId: string)` 方法
- 添加 `hasPendingExecution(userId: string)` 方法
- 在 `verifySession()` 成功后保留 session 供回调使用

#### 3. 修改 `src/server.ts` - `setNotifyCallback` 函数

- 认证成功后，检查是否有待执行的命令
- 通过 `api.runtime.channel.*sendMessage` 发送原始命令

#### 4. 修改 `index.ts` - `before_tool_call` hook

- 拦截时生成 `pendingExecutionId`
- 检测是否是自动重发（通过 pendingExecutionId）
- 如果用户已验证，清理标记并允许执行

#### 5. 更新 `README.md`

- 更新使用说明，反映自动执行行为

## 详细实现

### auth-manager.ts 添加方法

```typescript
private pendingExecutions = new Map<string, { sessionId: string; timestamp: number }>();

registerPendingExecution(userId: string, sessionId: string): void {
  this.pendingExecutions.set(userId, { sessionId, timestamp: Date.now() });
}

getAndClearPendingExecution(userId: string): string | null {
  const pending = this.pendingExecutions.get(userId);
  if (pending) {
    this.pendingExecutions.delete(userId);
    return pending.sessionId;
  }
  return null;
}

hasPendingExecution(userId: string): boolean {
  const pending = this.pendingExecutions.get(userId);
  if (!pending) return false;
  // 10分钟内有效
  return Date.now() - pending.timestamp < 10 * 60 * 1000;
}
```

### index.ts before_tool_call 修改

```typescript
api.on("before_tool_call", async (event, ctx) => {
  const { toolName, params } = event;

  // 检查是否是自动重发的命令
  if (authManager.hasPendingExecution(ctx.sessionKey || "unknown")) {
    const pendingSessionId = authManager.getAndClearPendingExecution(ctx.sessionKey || "unknown");
    if (pendingSessionId) {
      // 清理对应的 session
      const session = authManager.getSession(pendingSessionId);
      if (session && session.sessionId === pendingSessionId) {
        // 标记用户已验证
        authManager.markUserVerified(session.userId);
      }
    }
    // 允许执行（不再次拦截）
    return undefined;
  }

  // 原有拦截逻辑...
  const session = authManager.generateSession(userId, { ... });

  // 注册待执行
  authManager.registerPendingExecution(userId, session.sessionId);

  return { block: true, blockReason: "..." };
});
```

### server.ts setNotifyCallback 修改

```typescript
setNotifyCallback(async (session: AuthSession) => {
  api.logger.info(`[mfa-auth] User ${session.userId} verified, auto-executing pending command`);

  // 获取待执行的命令
  const commandBody = session.originalContext.commandBody;
  const channel = session.originalContext.channel;

  if (!commandBody || channel === "web") {
    // 没有待执行命令或 web 渠道，发送通知
    await deliverOutboundPayloads({ ... });
    return;
  }

  // 通过 runtime 发送原始命令，触发重新执行
  try {
    switch (channel) {
      case "telegram":
        await api.runtime.channel.telegram.sendMessageTelegram({
          cfg: loadConfig(),
          text: commandBody,
          to: session.originalContext.to,
          accountId: session.originalContext.accountId,
        });
        break;
      case "discord":
        await api.runtime.channel.discord.sendMessageDiscord({
          cfg: loadConfig(),
          text: commandBody,
          to: session.originalContext.to,
          accountId: session.originalContext.accountId,
        });
        break;
      // 其他渠道...
    }
    api.logger.info(`[mfa-auth] Pending command sent for auto-execution`);
  } catch (error) {
    api.logger.error(`[mfa-auth] Failed to send pending command: ${error}`);
    // 降级：发送通知让用户手动重发
    await deliverOutboundPayloads({ ... });
  }
});
```

## 注意事项

1. **避免循环**：通过 `pendingExecutionId` 标记自动重发，检测到后清理并允许执行
2. **超时清理**：`pendingExecutions` 10分钟自动清理
3. **web 渠道降级**：web 渠道无法发送消息，降级为通知
4. **错误处理**：发送失败时降级为手动通知
5. **验证状态同步**：认证成功后立即设置用户为已验证状态

## 测试场景

1. 用户发送敏感命令 → 拦截 → 认证 → 自动执行
2. 用户认证超时 → 降级为手动通知
3. web 渠道 → 降级为手动通知
4. 网络错误 → 降级为手动通知
