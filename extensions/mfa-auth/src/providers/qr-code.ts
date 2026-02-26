import type { AuthSession, AuthResult } from "../types.js";
import { BaseAuthProvider } from "./base.js";
import { renderQrPngBase64 } from "../qr.js";
import { config } from "../config.js";

export class QrCodeAuthProvider extends BaseAuthProvider {
  readonly methodType = "qr-code" as const;
  readonly name = "QR Code Authentication";
  readonly description = "Scan QR code to authenticate";

  async initialize(session: AuthSession): Promise<void> {}

  async verify(sessionId: string, userInput?: string): Promise<AuthResult> {
    return { success: true };
  }

  async generateAuthPage(session: AuthSession, authUrl: string): Promise<string> {
    const remainingTime = Math.max(
      0,
      Math.ceil((config.timeout - (Date.now() - session.timestamp)) / 1000),
    );
    const commandPreview =
      session.originalContext.commandBody.length > 100
        ? session.originalContext.commandBody.substring(0, 100) + "..."
        : session.originalContext.commandBody;

    const qrCode = await renderQrPngBase64(authUrl);

    return this.renderHtml(session.sessionId, commandPreview, qrCode, remainingTime);
  }

  private renderHtml(
    sessionId: string,
    commandPreview: string,
    qrCode: string,
    remainingTime: number,
  ): string {
    const escapedPreview = this.escapeHtml(commandPreview);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>二次认证</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 400px;
      width: 90%;
    }
    h1 {
      color: #333;
      margin-top: 0;
      font-size: 24px;
      text-align: center;
    }
    .info {
      background: #f7fafc;
      padding: 15px;
      border-radius: 6px;
      margin: 20px 0;
      font-size: 14px;
      color: #4a5568;
    }
    .info strong {
      color: #2d3748;
    }
    .timer {
      text-align: center;
      color: #e53e3e;
      font-weight: 600;
      margin: 10px 0;
    }
    .result {
      text-align: center;
      padding: 15px;
      border-radius: 6px;
      margin-top: 20px;
      font-weight: 600;
      display: none;
      white-space: pre-line;
    }
    .result.success {
      background: transparent;
      color: #111827;
      padding: 0;
      white-space: normal;
    }
    .result.error {
      background: #fed7d7;
      color: #742a2a;
    }
    .qr-section {
      text-align: center;
      margin: 20px 0;
      padding: 15px;
      background: #f7fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .qr-section h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #4a5568;
    }
    .qr-image {
      display: inline-block;
      padding: 10px;
      background: white;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .qr-link {
      font-size: 12px;
      color: #718096;
      word-break: break-all;
      margin-top: 10px;
    }
    body.success-mode {
      background: #ffffff;
    }
    .container.success-mode {
      max-width: 520px;
      width: 100%;
      box-shadow: none;
      border-radius: 0;
      padding: 70px 30px;
    }
    .success-view {
      text-align: center;
    }
    .success-icon {
      width: 110px;
      height: 110px;
      border-radius: 9999px;
      background: #67c23a;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 22px auto;
    }
    .success-icon::before {
      content: "✓";
      color: #ffffff;
      font-size: 64px;
      line-height: 1;
      font-weight: 700;
      transform: translateY(-2px);
    }
    .success-title {
      margin: 0 0 14px 0;
      font-size: 34px;
      color: #111827;
      letter-spacing: 1px;
    }
    .success-subtitle {
      margin: 0;
      font-size: 18px;
      color: #6b7280;
      line-height: 1.7;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 二次认证</h1>
    <div class="info">
      <p>待验证操作:</p>
      <strong>${escapedPreview}</strong>
    </div>
    <div class="qr-section">
      <h3>📱 请打开【数字身份助手APP】扫码</h3>
      <div class="qr-image">
        <img src="data:image/png;base64,${qrCode}" alt="认证二维码" width="200" height="200">
      </div>
    </div>
    <div class="timer">⏱️ 有效期: <span id="timer">${Math.floor(remainingTime / 60)}:${String(remainingTime % 60).padStart(2, "0")}</span></div>
    <div id="result" class="result"></div>
  </div>
  <script>
    const sessionId = "${sessionId}";
    let timeLeft = ${remainingTime};
    let timerInterval;

    function updateTimer() {
      const timerEl = document.getElementById('timer');
      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft % 60;
      timerEl.textContent = minutes + ':' + String(seconds).padStart(2, '0');
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        const result = document.getElementById('result');
        result.textContent = '验证码已过期，请重新获取';
        result.style.display = 'block';
        result.classList.add('error');
      }
      timeLeft--;
    }

    timerInterval = setInterval(updateTimer, 1000);

    setTimeout(async () => {
      const result = document.getElementById('result');
      const qrSection = document.querySelector('.qr-section');
      const timerDiv = document.querySelector('.timer');
      const infoEl = document.querySelector('.info');
      const headingEl = document.querySelector('h1');
      const containerEl = document.querySelector('.container');
      const operationEl = document.querySelector('.info strong');

      try {
        const response = await fetch('/mfa-auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        const data = await response.json();

        result.style.display = 'block';
        if (data.success) {
          const operationName = operationEl ? operationEl.textContent.trim() : '';
          const operationNameTag = operationName ? '【' + escapeHtml(operationName) + '】' : '';
          result.innerHTML =
            '<div class="success-view">' +
            '<div class="success-icon"></div>' +
            '<h2 class="success-title">扫码认证成功</h2>' +
            '<p class="success-subtitle">请回到聊天窗口，重新发送之前的命令' +
            operationNameTag +
            '即可执行。</p>' +
            '</div>';
          result.classList.add('success');
          result.classList.remove('error');
          clearInterval(timerInterval);
          qrSection.style.display = 'none';
          timerDiv.style.display = 'none';
          if (infoEl) infoEl.style.display = 'none';
          if (headingEl) headingEl.style.display = 'none';
          if (containerEl) containerEl.classList.add('success-mode');
          document.body.classList.add('success-mode');
        } else {
          result.textContent = '❌ 认证失败，请重试';
          result.classList.add('error');
          result.classList.remove('success');
        }
      } catch (error) {
        result.textContent = '认证失败，请重试';
        result.style.display = 'block';
        result.classList.add('error');
      }
    }, 10000);

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>
    `;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return text.replace(/[&<>"']/g, (c) => map[c]);
  }
}

export const qrCodeAuthProvider = new QrCodeAuthProvider();
