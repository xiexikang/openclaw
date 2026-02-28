## 优化计划

### 问题

1. 首次消息认证成功后，通知消息因 `feishu:` 前缀发送失败
2. `/reauth` 命令有回复（因为是命令返回值），但首次消息没有
3. 前端页面提示不够清晰

### 修复方案

#### 1. 修复 `notifyCallback` 中的 `feishu:` 前缀问题

- 在所有 `deliverOutboundPayloads` 调用前去除 channel 前缀
- 位置：`notifyCallback` 函数中
- 应用范围：首次消息认证、敏感操作认证、fallback 通知

#### 2. 优化前端页面提示

- 认证成功页面增加明确的成功提示
- 首次消息认证：显示"✅ 认证成功！请重新发送消息以继续对话"
- 敏感操作认证：显示"✅ 认证成功！请回到聊天窗口重新发送命令"
- 修改文件：`extensions/mfa-auth/src/providers/qr-code.ts`

#### 3. 优化消息提示文本

- 首次消息认证：🎉 首次认证成功！请重新发送消息以继续对话。
- 敏感操作认证：✅ 二次认证成功！请重新发送之前的命令以执行。

### 修改文件

1. `extensions/mfa-auth/index.ts` - 修复 `notifyCallback` 中的前缀问题
2. `extensions/mfa-auth/src/providers/qr-code.ts` - 优化前端提示
