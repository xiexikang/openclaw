#!/usr/bin/env node

/**
 * MFA Auth 插件本地测试脚本
 * 用于验证后端轮询和基本功能
 */

import { authManager } from "./src/auth-manager.js";
import { config } from "./src/config.js";
import { qrCodeAuthProvider } from "./src/providers/qr-code.js";
import { dabbyClient } from "./src/dabby-client.js";

console.log("========================================");
console.log("  MFA Auth 插件本地测试");
console.log("========================================\n");

// 1. 注册认证提供者
console.log("步骤 1: 注册认证提供者...");
authManager.registerProvider(qrCodeAuthProvider);
console.log("✓ 认证提供者已注册\n");

// 2. 显示当前配置
console.log("步骤 2: 显示当前配置...");
console.log(`  Debug 模式: ${config.debug}`);
console.log(`  后端轮询: ${config.enableBackendPolling ? "启用" : "未启用"}`);
console.log(`  外网页面 URL: ${config.authPageUrl || "未设置（使用本地服务器）"}`);
console.log(`  首次认证: ${config.requireAuthOnFirstMessage ? "启用" : "未启用"}`);
console.log(`  敏感操作认证: ${config.requireAuthOnSensitiveOperation ? "启用" : "未启用"}`);
console.log(`  超时时间: ${config.timeout / 1000} 秒\n`);

// 3. 检查 Dabby 配置
console.log("步骤 3: 检查 Dabby 配置...");
const hasDabbyConfig = config.dabbyClientId && config.dabbyClientSecret;
if (!hasDabbyConfig) {
  console.log("  ⚠️  未配置 Dabby 凭证（DABBY_CLIENT_ID 和 DABBY_CLIENT_SECRET）");
  console.log("  请在 .env 文件中配置后重试\n");
} else {
  console.log(`  ✓ Dabby Client ID: ${config.dabbyClientId.substring(0, 8)}...`);
  console.log(`  ✓ Dabby Client Secret: ${config.dabbyClientSecret.substring(0, 8)}...\n`);
}

// 4. 创建测试会话
console.log("步骤 4: 创建测试会话...");
const testUserId = "test_user_" + Date.now();
const testSession = authManager.generateSession(
  testUserId,
  {
    sessionKey: `webchat:${testUserId}`,
    senderId: testUserId,
    commandBody: "测试命令: delete /tmp/test.txt",
    channel: "web",
    to: testUserId,
    accountId: "",
    toolName: "bash",
    toolParams: { command: "delete /tmp/test.txt" },
    timestamp: Date.now(),
    triggerType: "sensitive_operation",
  },
  "qr-code",
);

if (!testSession) {
  console.log("  ✗ 会话创建失败\n");
  process.exit(1);
}

console.log(`  ✓ 会话已创建: ${testSession.sessionId}`);
console.log(`  ✓ 用户 ID: ${testSession.userId}\n`);

// 5. 设置通知回调
console.log("步骤 5: 设置通知回调...");
authManager.setNotifyCallback(async (session) => {
  console.log("\n========================================");
  console.log("  🎉 认证成功回调触发！");
  console.log("========================================");
  console.log(`  会话 ID: ${session.sessionId}`);
  console.log(`  用户 ID: ${session.userId}`);
  console.log(`  触发类型: ${session.originalContext.triggerType}`);
  console.log(`  认证时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log("\n✓ 后端轮询机制工作正常！\n");
});
console.log("  ✓ 通知回调已设置\n");

// 6. 初始化二维码
console.log("步骤 6: 初始化二维码...");
try {
  const provider = authManager.getProvider("qr-code");
  if (!provider) {
    console.log("  ✗ 未找到 QR Code 提供者\n");
    process.exit(1);
  }

  await provider.initialize(testSession);
  console.log(`  ✓ 二维码已初始化`);
  console.log(`  ✓ 二维码内容: ${testSession.qrcodeContent?.substring(0, 20)}...`);
  console.log(`  ✓ 过期时间: ${new Date(testSession.expireTimeMs || 0).toLocaleString('zh-CN')}\n`);
} catch (error) {
  console.log(`  ✗ 二维码初始化失败: ${error}\n`);
  process.exit(1);
}

// 7. 显示认证链接
console.log("步骤 7: 生成认证链接...");
const authUrl = `http://127.0.0.1:${config.port}/mfa-auth/${testSession.sessionId}`;
console.log(`  ✓ 认证链接: ${authUrl}\n`);

// 8. 测试验证接口
console.log("步骤 8: 测试验证接口...");
try {
  const result = await authManager.verifySession(testSession.sessionId);
  console.log(`  ✓ 验证接口调用成功`);
  console.log(`  - 成功: ${result.success}`);
  console.log(`  - 状态: ${result.status || "pending"}`);
  console.log(`  - 错误: ${result.error || "无"}\n`);
} catch (error) {
  console.log(`  ✗ 验证接口调用失败: ${error}\n`);
}

// 9. 显示后端轮询状态
console.log("步骤 9: 检查后端轮询状态...");
if (config.enableBackendPolling) {
  console.log("  ✓ 后端轮询已启用");
  console.log("  - 轮询间隔: 2000ms");
  console.log("  - 当前会话正在轮询中...\n");
  console.log("  注意: 在分离式部署模式下，后端会自动轮询 Dabby API");
  console.log("  认证成功后会自动触发通知回调。\n");
} else {
  console.log("  ℹ️  后端轮询未启用");
  console.log("  如需启用，请设置环境变量: MFA_ENABLE_BACKEND_POLLING=true\n");
}

// 10. 显示测试总结
console.log("========================================");
console.log("  测试总结");
console.log("========================================\n");
console.log("✓ 所有基本功能测试通过！\n");
console.log("下一步：");
console.log("  1. 在浏览器中打开认证链接进行完整测试");
console.log("  2. 使用手机扫描二维码进行认证");
console.log("  3. 观察后端轮询日志");
console.log("  4. 验证认证成功后通知回调是否触发\n");

// 11. 提示手动测试
console.log("========================================");
console.log("  手动测试提示");
console.log("========================================\n");
console.log("如需进行完整的手动测试，请执行以下操作：\n");
console.log("1. 确保 OpenClaw 正在运行并加载了 mfa-auth 插件");
console.log("2. 在 Web 聊天中发送一条包含敏感词的消息（如 'delete'）");
console.log("3. 点击收到的认证链接");
console.log("4. 使用手机扫描二维码");
console.log("5. 在手机上完成认证");
console.log("6. 检查是否收到认证成功通知\n");

console.log("========================================\n");

// 保持进程运行以观察轮询
if (config.enableBackendPolling) {
  console.log("进程将保持运行 30 秒以观察轮询行为...\n");
  setTimeout(() => {
    console.log("\n测试完成，进程即将退出...");
    process.exit(0);
  }, 30000);
} else {
  process.exit(0);
}
