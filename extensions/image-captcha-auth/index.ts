import { loadConfig } from "../../src/config/io.js";
import { deliverOutboundPayloads } from "../../src/infra/outbound/deliver.js";
import { resolveOutboundTarget } from "../../src/infra/outbound/targets.js";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { captchaManager } from "./src/captcha-manager.js";
import { config } from "./src/config.js";
import { renderQrPngBase64 } from "./src/qr.js";
import { startHttpServer, setNotifyCallback } from "./src/server.js";
import type { CaptchaSession } from "./src/types.js";

let serverStarted = false;

export default function register(api: OpenClawPluginApi) {
  setNotifyCallback(async (session: CaptchaSession) => {
    api.logger.info(`[captcha] User ${session.userId} verified, sending notification`);

    try {
      const cfg = loadConfig();

      const userIdParts = session.userId.split(":");
      // 尝试动态解析渠道：
      // 1. 优先使用 session.originalContext 中记录的 channel (最准确)
      // 2. 其次尝试从 session.userId 解析
      let channel = session.originalContext.channel;

      if (!channel) {
        // 增强的渠道检测逻辑：遍历 ID 部分查找已知渠道名
        const knownChannels = ["discord", "telegram", "slack", "whatsapp", "signal", "feishu"];

        for (const part of userIdParts) {
          if (knownChannels.includes(part)) {
            channel = part;
            break;
          }
        }
      }

      if (!channel || channel === "main") {
        channel = "web";
      }

      const to =
        session.originalContext.to || userIdParts[userIdParts.length - 1] || session.userId;

      api.logger.info(
        `[captcha] Resolved channel: ${channel}, to: ${to} for user: ${session.userId}`,
      );

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

      const authUrl = `http://localhost:${config.port}/captcha/${session.sessionId}`;

      await deliverOutboundPayloads({
        cfg,
        channel,
        to: resolvedTo,
        accountId: session.originalContext.accountId,
        payloads: [
          {
            text: `✅ 二次认证成功！\n\n请重新发送消息命令以执行操作。`,
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

    const sessionKey = ctx.sessionKey || "";
    const sessionKeyParts = sessionKey.split(":").filter(Boolean);

    const parsedChannel = sessionKeyParts[2] || undefined;
    const parsedAccountId = sessionKeyParts[3] || undefined;
    const parsedTo = sessionKeyParts[sessionKeyParts.length - 1] || undefined;

    api.logger.info(
      `[captcha] Parsed from sessionKey: channel=${parsedChannel}, accountId=${parsedAccountId}, to=${parsedTo}`,
    );

    const session = captchaManager.generate(userId, {
      sessionKey,
      senderId: userId,
      commandBody: command,
      channel: parsedChannel,
      to: parsedTo,
      accountId: parsedAccountId,
      toolName,
      toolParams: params,
      timestamp: Date.now(),
    });

    const authUrl = `http://localhost:${config.port}/captcha/${session.sessionId}`;

    api.logger.info(`[captcha] Blocking sensitive tool call: ${toolName} from ${userId}`);

    if (parsedChannel && parsedChannel !== "web") {
      try {
        const cfg = loadConfig();
        const to = parsedTo || userId;

        let resolvedTo = to;
        try {
          const resolved = resolveOutboundTarget({
            channel: parsedChannel,
            to,
            cfg,
            accountId: parsedAccountId,
            mode: "explicit",
          });

          if (resolved.ok) {
            resolvedTo = resolved.to;
          }
        } catch (e) {
          api.logger.warn(`[captcha] Error resolving target: ${e}`);
        }

        await deliverOutboundPayloads({
          cfg,
          channel: parsedChannel,
          to: resolvedTo,
          accountId: parsedAccountId,
          payloads: [
            {
              text: `🔐 该操作需要二次认证\n\n检测到敏感操作: ${preview}\n\n请点击链接完成验证:\n${authUrl}\n\n验证有效期: 5 分钟\n\n验证成功后，请重新发送命令。`,
            },
          ],
        });
      } catch (error) {
        api.logger.error(`[captcha] Failed to send QR notification: ${String(error)}`);
      }
    }

    return {
      block: true,
      blockReason: `🔐 该操作需要二次认证`,
    };
  });

  if (!serverStarted) {
    api.logger.info("image-captcha-auth: Starting HTTP server...");
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
