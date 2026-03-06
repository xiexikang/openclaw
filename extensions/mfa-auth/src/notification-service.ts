import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import * as Lark from "@larksuiteoapi/node-sdk";
import { resolveFeishuAccount } from "../../feishu/src/accounts.js";
import { createFeishuClient } from "../../feishu/src/client.js";
import { resolveFeishuSendTarget } from "../../feishu/src/send-target.js";
import { getFeishuRuntime } from "../../feishu/src/runtime.js";
import { assertFeishuMessageApiSuccess, toFeishuSendResult } from "../../feishu/src/send-result.js";
import type { AuthSession } from "./types.js";

class NotificationService {
  private static instance: NotificationService;
  private cfg?: ClawdbotConfig;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  setConfig(cfg: ClawdbotConfig): void {
    this.cfg = cfg;
  }

  async sendAuthNotification(session: AuthSession, message: string): Promise<void> {
    const { channel, accountId, to } = session.originalContext;

    if (!this.cfg) {
      console.warn("[mfa-auth] Config not set, skipping notification");
      return;
    }

    if (channel === "web") {
      console.log(`[mfa-auth] Web channel: auth link would be shown in UI`);
      return;
    }

    if (channel === "feishu") {
      await this.sendToFeishu(session, message);
      return;
    }

    console.warn(`[mfa-auth] Unsupported channel: ${channel}`);
  }

  private async sendToFeishu(session: AuthSession, message: string): Promise<void> {
    const { accountId, to } = session.originalContext;

    if (!this.cfg) {
      console.warn("[mfa-auth] Config not set, cannot send Feishu message");
      return;
    }

    if (!to) {
      console.warn("[mfa-auth] Feishu target 'to' is missing, cannot send message");
      return;
    }

    try {
      const { client, receiveId, receiveIdType } = resolveFeishuSendTarget({
        cfg: this.cfg,
        to,
        accountId,
      });

      let messageText = message;
      
      try {
        const tableMode = getFeishuRuntime().channel.text.resolveMarkdownTableMode({
          cfg: this.cfg,
          channel: "feishu",
        });

        messageText = getFeishuRuntime().channel.text.convertMarkdownTables(
          message,
          tableMode,
        );
      } catch (error) {
        if (error instanceof Error && error.message === "Feishu runtime not initialized") {
          console.warn("[mfa-auth] Feishu runtime not initialized yet, using original message text");
          messageText = message;
        } else {
          throw error;
        }
      }

      const { content, msgType } = this.buildFeishuPostMessagePayload({
        messageText,
      });

      const response = await client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          content,
          msg_type: msgType,
        },
      });

      assertFeishuMessageApiSuccess(response, "Feishu send failed");
      const result = toFeishuSendResult(response, receiveId);
      console.log(
        `[mfa-auth] Feishu message sent: ${result.messageId} to ${to}`,
      );
    } catch (error) {
      console.error(`[mfa-auth] Failed to send Feishu message: ${error}`);
      throw error;
    }
  }

  private buildFeishuPostMessagePayload(params: {
    messageText: string;
  }): {
    content: string;
    msgType: string;
  } {
    const { messageText } = params;
    return {
      content: JSON.stringify({
        zh_cn: {
          content: [
            [
              {
                tag: "md",
                text: messageText,
              },
            ],
          ],
        },
      }),
      msgType: "post",
    };
  }
}

export { NotificationService };
