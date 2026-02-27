## 修改计划

### 1. 修改前端页面 (`extensions/mfa-auth/src/server.ts`)

- 修改 `renderQrPage` 函数，根据 `triggerType` 动态显示标题
  - `first_message` → 显示"首次认证"
  - `sensitive_operation` → 显示"二次认证"
- 修改认证成功后的提示消息，根据 `triggerType` 显示不同内容
  - `first_message` → "请回到聊天窗口，继续与AI 机器人对话。"

### 2. 修改消息通知 (`extensions/mfa-auth/index.ts`)

- 修改 `message_received` 钩子中的通知文案
  - 标题改为"首次对话需要进行认证"
- 修改 `/reauth` 命令中的通知文案
  - 标题改为"🔐 重新认证"

### 3. 运行类型检查和 lint

- 确保代码质量
