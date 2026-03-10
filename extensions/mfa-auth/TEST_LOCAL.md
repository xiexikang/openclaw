# MFA Auth 插件本地测试指南

## 快速开始

### 1. 安装依赖

```bash
cd extensions/mfa-auth
npm install
```

### 2. 配置环境变量

复制测试配置模板：

```bash
cp .env.test .env
```

编辑 `.env` 文件，填入你的 Dabby 凭证：

```bash
# 必填：Dabby 凭证
DABBY_CLIENT_ID=your_client_id_here
DABBY_CLIENT_SECRET=your_client_secret_here
```

**获取 Dabby 凭证：**
1. 访问 https://www.dabby.com/
2. 注册/登录账号
3. 在控制台获取 Client ID 和 Client Secret

### 3. 运行测试脚本

```bash
node test-local.mjs
```

## 测试步骤

### 步骤 1：基础功能测试

测试脚本会自动验证以下功能：
- ✓ 认证提供者注册
- ✓ 配置加载
- ✓ 会话创建
- ✓ 通知回调设置
- ✓ 二维码初始化
- ✓ 认证链接生成
- ✓ 验证接口调用
- ✓ 后端轮询状态

### 步骤 2：集成测试（需要 OpenClaw 运行）

1. **启动 OpenClaw**

确保 OpenClaw 已加载 mfa-auth 插件：

```bash
# 在 OpenClaw 目录
pnpm dev
```

2. **检查插件状态**

在 Web 聊天中输入：
```
/status
```

查看插件列表中是否包含 `mfa-auth`。

3. **触发敏感操作认证**

在 Web 聊天中发送：
```
帮我删除 /tmp/test.txt 文件
```

应该收到认证链接：
```
🔐 该操作需要二次认证

检测到敏感操作: 帮我删除 /tmp/test.txt 文件

请点击链接完成验证:
http://127.0.0.1:18801/mfa-auth/session_xxx

验证有效期: 5 分钟

验证成功后，请回复"确认"或者重新发送之前的命令以继续执行。
```

4. **完成认证**

1. 点击认证链接，打开认证页面
2. 使用手机扫描二维码
3. 在手机上完成认证

5. **验证结果**

认证成功后应该收到通知：
```
✅ 二次认证成功！

请回到聊天窗口，重新发送之前的命令【帮我删除 /tmp/test.txt 文件】即可执行。
```

## 测试场景

### 场景 1：首次消息认证

**配置：**
```bash
MFA_REQUIRE_AUTH_ON_FIRST_MESSAGE=true
```

**测试步骤：**
1. 发送第一条消息：`你好`
2. 应该收到首次认证链接
3. 扫码认证
4. 重新发送消息

**预期结果：**
- 首次消息被拦截
- 认证链接发送成功
- 认证成功后可以正常对话

### 场景 2：敏感操作认证

**配置：**
```bash
MFA_REQUIRE_AUTH_ON_SENSITIVE_OPERATION=true
MFA_SENSITIVE_KEYWORDS=delete,remove,rm
```

**测试步骤：**
1. 发送包含敏感词的消息：`delete /tmp/test.txt`
2. 应该收到二次认证链接
3. 扫码认证
4. 重新发送命令

**预期结果：**
- 敏感操作被拦截
- 认证链接发送成功
- 认证成功后命令可以执行

### 场景 3：重新认证

**测试步骤：**
1. 发送命令：`/reauth`
2. 应该收到重新认证链接
3. 扫码认证

**预期结果：**
- 清除之前的认证状态
- 发送新的认证链接
- 认证成功后重新建立信任

### 场景 4：后端轮询测试

**配置：**
```bash
MFA_ENABLE_BACKEND_POLLING=true
```

**测试步骤：**
1. 触发认证流程
2. 打开认证链接
3. 在手机上完成认证
4. 观察 OpenClaw 日志

**预期结果：**
- 日志中显示轮询开始：`[mfa-auth] Started backend polling for session: xxx`
- 认证成功后显示：`[mfa-auth] Backend polling: Session verified: xxx`
- 轮询自动停止：`[mfa-auth] Stopped backend polling for session: xxx`

### 场景 5：超时测试

**测试步骤：**
1. 触发认证流程
2. 等待 5 分钟（默认超时时间）
3. 尝试访问认证链接

**预期结果：**
- 认证链接显示"二维码已过期或不存在"
- 轮询自动停止
- 会话被清理

## 常见问题排查

### 问题 1：插件未加载

**症状：** `/status` 命令看不到 mfa-auth 插件

**解决方案：**
1. 检查 `openclaw.json` 配置：
```json
{
  "plugins": {
    "enabled": true,
    "allow": ["mfa-auth"],
    "load": {
      "paths": [
        "/absolute/path/to/extensions/mfa-auth"
      ]
    },
    "entries": {
      "mfa-auth": {
        "enabled": true
      }
    }
  }
}
```

2. 确保 `paths` 中的路径是绝对路径

### 问题 2：认证链接无法访问

**症状：** 点击链接显示"连接被拒绝"

**解决方案：**
1. 检查 HTTP 服务器是否启动：`netstat -ano | findstr :18801`
2. 查看日志是否有启动错误
3. 确保端口 18801 未被占用

### 问题 3：二维码生成失败

**症状：** 认证页面显示"正在生成二维码..."一直加载

**解决方案：**
1. 检查 Dabby 凭证是否正确
2. 查看日志中的错误信息
3. 确认网络可以访问 Dabby API

### 问题 4：认证成功但未收到通知

**症状：** 扫码认证成功，但没有收到飞书/Web 通知

**解决方案：**
1. 检查后端轮询是否启用：`MFA_ENABLE_BACKEND_POLLING=true`
2. 查看日志中是否有认证成功的记录
3. 检查飞书/Web 配置是否正确

### 问题 5：轮询没有停止

**症状：** 认证成功/失败后，轮询仍在继续

**解决方案：**
1. 检查日志中是否有停止轮询的记录
2. 查看 `pollingTimers` 是否正确清理
3. 重启 OpenClaw 重置状态

## 调试技巧

### 启用调试日志

```bash
# 在 .env 中设置
MFA_DEBUG=true
```

### 查看 HTTP 服务器日志

```bash
# 启动 OpenClaw 后，观察控制台输出
pnpm dev
```

### 手动测试认证接口

```bash
# 测试验证接口
curl -X POST http://127.0.0.1:18801/mfa-auth/verify \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "your_session_id"}'
```

### 检查会话状态

在测试脚本中添加调试代码：

```javascript
const session = authManager.getSession("your_session_id");
console.log("Session:", session);
```

## 性能测试

### 轮询性能

- 默认轮询间隔：2 秒
- 每个会话独立轮询
- 认证成功/失败后立即停止

### 内存使用

- 每个会话占用：约 1-2KB
- 过期会话自动清理
- 建议定期重启 OpenClaw 清理内存

## 分离式部署测试

### 配置外网页面

```bash
# 在 .env 中设置
MFA_AUTH_PAGE_URL=https://auth.example.com/auth/auth.html
```

### 测试步骤

1. 部署 `public/auth.html` 到外网服务器
2. 配置 `MFA_AUTH_PAGE_URL`
3. 触发认证流程
4. 验证收到的链接是外网 URL
5. 在外网页面扫码认证
6. 验证本地 OpenClaw 能检测到认证成功

## 下一步

测试通过后，可以：

1. **配置生产环境**
   - 设置合适的超时时间
   - 配置敏感关键词列表
   - 启用飞书通知

2. **部署外网页面**
   - 部署 `public/auth.html` 到 CDN
   - 配置 HTTPS
   - 设置防盗链

3. **监控和日志**
   - 启用日志记录
   - 设置告警规则
   - 定期检查认证成功率

## 参考文档

- [分离式部署指南](./DEPLOY_SEPARATE.md)
- [README](./README.md)
- [OpenClaw 文档](../../docs/cli/plugins.md)
