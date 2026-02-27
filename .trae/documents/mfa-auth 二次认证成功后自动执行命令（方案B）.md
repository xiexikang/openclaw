# 集成 Dabby 第三方认证系统 - 完整实现方案

## 概述

将 mfa-auth 插件从模拟自动扫码改为使用 Dabby 第三方认证系统（3个API接口），实现真实的扫码认证流程。

## 实现步骤

### 1. 更新类型定义

**文件**: `src/types.ts`

**添加内容**:

- 添加 `AuthStatus` 枚举：`pending` | `scanned` | `verified` | `failed` | `expired`

- 扩展 `AuthSession` 接口：添加 `certToken`, `qrcodeContent`, `expireTimeMs`, `authStatus` 字段

- 添加 Dabby API 响应类型定义

- 添加 Dabby 配置接口

### 2. 更新配置文件

**文件**: `src/config.ts`

**添加内容**:

- 添加 Dabby API 配置对象（clientId, clientSecret, apiBaseUrl）

- 添加轮询间隔配置（pollInterval: 2000）

- 添加 accessToken 缓存配置（tokenCacheDuration）

### 3. 创建 Dabby API 客户端

**文件**: `src/dabby-client.ts`（新建）

**功能**:

- `DabbyClient` 类

- `getAccessToken()`: 调用接口1，支持缓存（2小时）

- `getQrCode()`: 调用接口2，返回 certToken 和 qrcodeContent

- `getAuthResult()`: 调用接口3，查询认证结果

- `refreshAccessToken()`: 自动刷新 token

- 错误处理和重试逻辑

### 4. 改造认证管理器

**文件**: `src/auth-manager.ts`

**改动**:

- 修改 `generateSession()` 方法：接受额外的 certToken、qrcodeContent、expireTimeMs 参数

- 添加 `updateAuthStatus()` 方法：更新认证状态

- 添加 `getCertToken()` 方法：获取 certToken

- 扩展 `cleanup()` 方法：清理 Dabby 认证资源

### 5. 重写二维码认证提供者

**文件**: `src/providers/qr-code.ts`

**改动**:

- `initialize()`: 调用 Dabby API 获取二维码，存储到 session

- `verify()`: 调用 Dabby API 查询认证结果，返回状态

- `generateAuthPage()`:
  - 使用 Dabby 返回的 qrcodeContent 生成二维码

  - 前端实现轮询机制（每 2 秒）

  - 显示认证状态（等待扫码 → 已扫码 → 认证成功）

  - 倒计时显示

- `cleanup()`: 清理认证状态

### 6. 改造 HTTP 服务器

**文件**: `src/server.ts`

**改动**:

- 修改 `/mfa-auth/verify` 接口：返回认证状态和详细信息

- 添加错误处理：处理 Dabby API 异常、token 过期等

- 改进响应格式：返回 `status` 字段供前端判断

### 7. 更新插件入口

**文件**: `index.ts`

**改动**:

- 导入 `dabbyClient`

- 可选：在插件启动时预获取 accessToken

### 8. 添加单元测试

**文件**: `src/dabby-client.test.ts`（新建）

**测试内容**:

- accessToken 获取和刷新

- 二维码获取

- 认证结果查询

- 错误处理（网络异常、API 错误）

### 9. 更新文档

**文件**: `README.md`

**更新内容**:

- 添加 Dabby 认证系统说明

- 更新配置说明（clientId、clientSecret）

- 更新 API 文档

- 添加故障排除指南

## 技术细节

### Dabby API 调用流程

```typescript
// 1. 获取 accessToken
GET https://api.dabby.com.cn/v2/api/getaccesstoken
参数: { clientId, clientSecret }
返回: { accessToken, expireSeconds: 7200, retCode: 0 }

// 2. 获取二维码
POST https://api.dabby.com.cn/v2/api/authreq
参数: { accessToken, authType: 'ScanAuth', mode: 66 }
返回: {
  tokenInfo: {
    certToken,
    qrcodeContent: 'https://h5.dabby.com.cn/authhtml/#/auth?certToken=xxx',
    expireTimeMs
  }
}

// 3. 查询认证结果
POST https://api.dabby.com.cn/v2/api/authhist
参数: { accessToken, authHistQry: { certToken } }
返回: {
  authData: {
    resCode: 0,  // 0=成功
    authObject: { idNum, fullName }
  }
}
```

### 前端轮询逻辑

```javascript
let pollInterval;
let timeLeft = 300; // 5分钟

function startPolling() {
  pollInterval = setInterval(async () => {
    try {
      const response = await fetch("/mfa-auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await response.json();

      if (data.success) {
        clearInterval(pollInterval);
        showSuccess();
      } else if (data.status === "scanned") {
        updateStatus("已扫码，请在手机上确认");
      } else if (data.status === "failed") {
        clearInterval(pollInterval);
        showError(data.error || "认证失败");
      }
    } catch (error) {
      // 网络错误，继续轮询
    }

    // 更新倒计时
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(pollInterval);
      showExpired();
    }
  }, 2000);
}
```

### 配置示例

```typescript
// src/config.ts
export const config: MfaConfig = {
  // ... 现有配置
  dabby: {
    clientId: process.env.DABBY_CLIENT_ID || "",
    clientSecret: process.env.DABBY_CLIENT_SECRET || "",
    apiBaseUrl: "https://api.dabby.com.cn/v2/api",
    tokenCacheDuration: 7000000, // 2小时 - 100s缓冲
    pollInterval: 2000, // 2秒
  },
};
```

### 状态流转

```
pending (等待扫码)
  ↓
scanned (已扫码，待确认)
  ↓
verified (认证成功)

其他情况:
failed (认证失败)
expired (二维码过期)
```

## 错误处理

- **accessToken 过期**: 自动刷新并重试

- **二维码过期**: 显示过期提示，支持刷新

- **网络错误**: 显示错误提示，支持重试

- **API 错误**: 解析 retCode 和 retMessage，友好提示

## 安全性

- `clientSecret` 通过环境变量配置

- accessToken 内存缓存，定期刷新

- certToken 仅在会话生命周期内有效

- 请求超时设置

## 文件清单

**新建文件**:

- `src/dabby-client.ts` - Dabby API 客户端

- `src/dabby-client.test.ts` - 单元测试

**修改文件**:

- `src/types.ts` - 添加类型定义

- `src/config.ts` - 添加 Dabby 配置

- `src/auth-manager.ts` - 扩展会话管理

- `src/providers/qr-code.ts` - 重写认证逻辑

- `src/server.ts` - 改造验证接口

- `index.ts` - 导入客户端

- `README.md` - 更新文档
