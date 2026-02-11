import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import type { CaptchaSession } from "./src/types.js";
import { loadConfig } from "../../src/config/io.js";
import { deliverOutboundPayloads } from "../../src/infra/outbound/deliver.js";
import { resolveOutboundTarget } from "../../src/infra/outbound/targets.js";
import { captchaManager } from "./src/captcha-manager.js";
import { config } from "./src/config.js";
import { startHttpServer, setNotifyCallback } from "./src/server.js";

let serverStarted = false;

export default function register(api: OpenClawPluginApi) {
  setNotifyCallback(async (session: CaptchaSession) => {
    api.logger.info(`[captcha] User ${session.userId} verified, sending notification`);

    try {
      const cfg = loadConfig();

      const userIdParts = session.userId.split(":");
      // 尝试动态解析渠道：
      // 1. 优先使用 session.originalContext 中记录的 channel (最准确)
      // 2. 其次尝试从 session.userId (格式如 agent:main:channel:id) 解析
      // 3. 如果都失败，回退到 "web" (Dashboard)
      let channel = session.originalContext.channel;
      if (!channel && userIdParts.length >= 6) {
        // 假设 ID 结构类似于 agent:main:main:user:telegram:12345
        // userIdParts[5] 通常是 channel name
        channel = userIdParts[5];
      }
      if (!channel) {
        channel = "web";
      }

      const to = session.originalContext.to || userIdParts[7] || session.userId;

      // 如果是 web 渠道，直接跳过发送通知，因为目前不支持 WebChat 主动推送
      if (channel === "web") {
        api.logger.info(
          `[captcha] Web channel detected for ${session.userId}. Skipping notification (not supported), but verification is successful.`,
        );
        return;
      }

      let resolvedTo = to;
      try {
        const resolved = resolveOutboundTarget({
          channel,
          to,
          cfg,
          accountId: session.originalContext.accountId,
          mode: "explicit",
        });

        if (resolved.ok) {
          resolvedTo = resolved.to;
        } else {
          // 如果解析失败但渠道是 web，我们尝试直接发送（因为 web 通常不需要复杂的解析）
          // 或者仅记录警告并继续（取决于 deliverOutboundPayloads 是否能处理）
          api.logger.warn(
            `[captcha] Failed to resolve target: ${String(resolved.error)}. Trying to send anyway for channel: ${channel}`,
          );
        }
      } catch (e) {
        api.logger.warn(`[captcha] Error resolving target: ${e}. Proceeding with original 'to'.`);
      }

      await deliverOutboundPayloads({
        cfg,
        channel,
        to: resolvedTo,
        accountId: session.originalContext.accountId,
        payloads: [
          {
            text: `✅ 二次认证成功！\n\n验证的有效期为 ${config.verificationDuration / 1000} 秒。\n\n请重新发送命令以执行操作。`,
          },
        ],
      });

      api.logger.info(`[captcha] Notification sent successfully to ${session.userId}`);
    } catch (error) {
      api.logger.error(`[captcha] Failed to send notification: ${String(error)}`);
    }
  });

  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;

    api.logger.info(`[captcha] Tool call detected: ${toolName}`);

    const sensitiveTools = ["bash", "exec", "runCommand", "command", "process"];
    if (!sensitiveTools.includes(toolName)) {
      api.logger.info(`[captcha] Tool ${toolName} is not in sensitive list, allowing`);
      return undefined;
    }

    const command =
      typeof params?.command === "string"
        ? params.command
        : typeof params?.cmd === "string"
          ? params.cmd
          : typeof params?.input === "string"
            ? params.input
            : typeof params?.args === "string"
              ? params.args
              : "";

    api.logger.info(`[captcha] Extracted command from ${toolName}: ${command}`);

    if (!command) {
      api.logger.info(`[captcha] No command found in params, allowing`);
      return undefined;
    }

    const { isSensitive, preview } = checkSensitiveOperation(command);
    if (!isSensitive) {
      api.logger.info(`[captcha] Command is not sensitive, allowing`);
      return undefined;
    }

    const userId = ctx.sessionKey || "unknown";

    if (captchaManager.isUserVerified(userId)) {
      api.logger.info(`[captcha] User ${userId} is verified, allowing`);
      return undefined;
    }

    const session = captchaManager.generate(userId, {
      sessionKey: ctx.sessionKey || "",
      senderId: userId,
      commandBody: command,
      channel: (ctx as any).messageChannel,
      to: (ctx as any).agentAccountId,
      accountId: (ctx as any).agentAccountId,
      toolName,
      toolParams: params,
      timestamp: Date.now(),
    });

    const authUrl = `http://localhost:${config.port}/captcha/${session.sessionId}`;

    api.logger.info(`[captcha] Blocking sensitive tool call: ${toolName} from ${userId}`);

    return {
      block: true,
      blockReason: `🔐 该操作需要二次认证\n\n检测到敏感操作: ${preview}\n\n请点击以下链接完成验证:\n${authUrl}\n\n验证码有效期: ${config.timeout / 1000} 秒\n\n验证成功后，请重新发送命令。`,
    };
  });

  if (!serverStarted) {
    startHttpServer();
    serverStarted = true;
    api.logger.info("image-captcha-auth plugin loaded");
  }
}

function checkSensitiveOperation(text: string): { isSensitive: boolean; preview: string } {
  const lowerText = text.toLowerCase();

  for (const keyword of config.sensitiveKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      const preview = text.length > 50 ? text.substring(0, 50) + "..." : text;
      return { isSensitive: true, preview };
    }
  }

  return { isSensitive: false, preview: "" };
}
