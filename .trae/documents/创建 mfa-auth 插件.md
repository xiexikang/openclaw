## mfa-auth 插件实现计划

### 插件架构设计

采用**认证提供者模式**，支持多种认证方式的可插拔扩展：

```
extensions/mfa-auth/
├── index.ts                      # 插件主入口
├── package.json                  # NPM 配置
├── openclaw.plugin.json         # 插件元数据
├── README.md                     # 说明文档
├── src/
│   ├── types.ts                 # 类型定义
│   ├── config.ts                # 配置
│   ├── auth-manager.ts          # 认证管理器（核心）
│   ├── providers/               # 认证提供者（可扩展）
│   │   ├── base.ts              # 基础认证提供者接口
│   │   └── qr-code.ts           # 二维码认证提供者
│   ├── server.ts                # HTTP 服务器
│   └── qr.ts                    # 二维码生成工具
```

### 核心特性

1. **可插拔认证提供者**
   - 定义 `AuthMethodProvider` 接口

   - 当前实现 `QrCodeAuthProvider`（二维码认证）

   - 预留接口：`ImageCaptchaAuthProvider`、`SmsAuthProvider`、`EmailAuthProvider`

2. **认证管理器**
   - 管理多个认证会话

   - 支持用户验证状态追踪

   - 自动清理过期会话

3. **功能流程**（与 image-captcha-auth 一致）
   - 用户发送敏感命令 → 系统拦截并发送验证链接

   - 打开验证链接 → 显示二维码页面

   - 等待 10 秒 → 自动模拟扫码成功

   - 显示成功提示 → 发送通知消息回机器人

   - 用户重新发送命令 → 正常执行

4. **配置项**
   - 验证超时时间（5 分钟）

   - 验证通过后免验证时长（2 分钟）

   - HTTP 服务器端口（18801）

   - 敏感关键词列表

   - 白名单用户

### 扩展性设计

后续添加新认证方式只需：

1. 创建新的 Provider（如 `src/providers/sms.ts`）
2. 实现 `AuthMethodProvider` 接口
3. 在配置中启用

### 文件清单

1. `extensions/mfa-auth/package.json` - NPM 包配置
2. `extensions/mfa-auth/openclaw.plugin.json` - 插件元数据
3. `extensions/mfa-auth/index.ts` - 插件入口
4. `extensions/mfa-auth/src/types.ts` - 类型定义
5. `extensions/mfa-auth/src/config.ts` - 配置
6. `extensions/mfa-auth/src/auth-manager.ts` - 认证管理器
7. `extensions/mfa-auth/src/providers/base.ts` - 基础接口
8. `extensions/mfa-auth/src/providers/qr-code.ts` - 二维码认证
9. `extensions/mfa-auth/src/server.ts` - HTTP 服务器
10. `extensions/mfa-auth/src/qr.ts` - 二维码生成
11. `extensions/mfa-auth/README.md` - 说明文档
