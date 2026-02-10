# Image Captcha Auth

OpenClaw 图形验证码二次认证插件，用于保护敏感操作。

## 功能特性

- 自动检测敏感操作（如删除文件、系统命令等）
- 在聊天对话中发送二次认证链接
- 用户点击链接完成验证码验证
- 验证成功后获得临时权限（5分钟）
- 简洁的 Web 验证界面

## 安装

插件已包含在 OpenClaw 扩展中，无需额外安装。

## 使用方法

### 1. 启动插件

插件会在 OpenClaw 网关启动时自动加载。

### 2. 执行敏感操作

当你在聊天机器人中执行敏感操作时，例如：

```
请删除 /path/to/file.txt
```

机器人会回复：

```
🔐 该操作需要二次认证

检测到敏感操作: 请删除 /path/to/file.txt

请点击以下链接完成验证:
http://localhost:18800/captcha/xxxxx

验证码有效期: 60 秒

验证成功后，请重新发送命令。
```

### 3. 完成验证

点击链接后，会打开一个包含验证码图片的网页：

- 输入图片中的 4 位验证码
- 点击"验证"按钮
- 验证成功后会有提示

### 4. 重新发送命令

验证成功后，在 5 分钟内重新发送命令即可执行。

## 敏感操作列表

以下操作会触发二次认证：

- `delete` / `remove` / `rm` / `unlink` - 删除文件
- `format` / `wipe` / `erase` - 格式化磁盘
- `exec` / `eval` / `system` / `shell` / `bash` - 执行命令
- `sudo` / `su` / `chmod` / `chown` - 权限操作
- `restart` / `shutdown` / `reboot` - 系统控制
- `gateway` - 网关操作

## 配置

配置文件位于 `src/config.ts`：

```typescript
export const config: CaptchaConfig = {
  timeout: 60000,                    // 验证码有效期（毫秒）
  verificationDuration: 5 * 60 * 1000, // 验证成功后的免验证时长（毫秒）
  port: 18800,                       // HTTP 服务端口
  debug: false,                        // 调试模式
  sensitiveKeywords: [...],              // 敏感关键词列表
  allowlistUsers: []                   // 白名单用户（无需验证）
};
```

## 白名单用户

将用户 ID 添加到 `allowlistUsers` 数组中，这些用户执行敏感操作时无需验证。

## 开发

```bash
cd extensions/image-captcha-auth
npm run dev
```

## 架构

- `index.ts` - 插件入口
- `src/command.ts` - `/verify` 命令处理
- `src/command-handler.ts` - 敏感命令拦截器
- `src/captcha-manager.ts` - 验证码生成和管理
- `src/server.ts` - HTTP 验证服务器
- `src/config.ts` - 配置
- `src/types.ts` - TypeScript 类型定义
