import crypto from "node:crypto";
import http from "node:http";
import { captchaManager } from "./captcha-manager.js";
import { config } from "./config.js";
import { renderQrPngBase64 } from "./qr.js";
import type { CaptchaSession } from "./types.js";

let notifyCallback: ((session: CaptchaSession) => void | Promise<void>) | null = null;

export function setNotifyCallback(callback: (session: CaptchaSession) => void | Promise<void>) {
  console.log("[image-captcha-auth] setNotifyCallback called");
  notifyCallback = callback;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

export function startHttpServer() {
  console.log(
    "[image-captcha-auth] startHttpServer called, attempting to start server on port",
    config.port,
  );
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    if (url.pathname.startsWith("/captcha/")) {
      const sessionId = url.pathname.split("/")[2];

      if (req.method === "POST") {
        if (url.searchParams.has("simulate-scan")) {
          const session = captchaManager.getSession(sessionId);
          if (!session) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "Session not found" }));
            return;
          }

          const isValid = captchaManager.verifyByScan(sessionId);
          if (isValid && notifyCallback) {
            await notifyCallback(session);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: isValid }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const { code } = JSON.parse(body);
            const session = captchaManager.getSession(sessionId);

            if (!session) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false, error: "Session not found" }));
              return;
            }

            const isValid = captchaManager.verify(sessionId, code, session.userId);

            if (isValid) {
              if (notifyCallback) {
                await notifyCallback(session);
              }
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: isValid }));
          } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "Invalid request" }));
          }
        });
        return;
      }

      if (req.method === "GET") {
        const session = captchaManager.getSession(sessionId);

        if (config.debug) {
          console.log(`[captcha] GET request for sessionId: ${sessionId}`);
          console.log(`[captcha] Session found: ${!!session}`);
          console.log(
            `[captcha] All sessions: ${Array.from(captchaManager.getSessionIds()).join(", ")}`,
          );
        }

        if (!session) {
          if (config.debug) {
            console.log(`[captcha] Session not found or expired: ${sessionId}`);
          }
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>验证二维码不存在</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
                .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
                h1 { color: #e53e3e; margin-top: 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>❌ 验证码不存在或已过期</h1>
                <p>请重新执行敏感操作以获取新的验证码</p>
              </div>
            </body>
            </html>
          `);
          return;
        }

        if (url.searchParams.has("refresh")) {
          session = captchaManager.refresh(sessionId);
          if (!session) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "Session not found" }));
            return;
          }
          const remainingTime = Math.max(
            0,
            Math.ceil((config.timeout - (Date.now() - session.timestamp)) / 1000),
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, remainingTime }));
          return;
        }

        if (url.searchParams.has("svg")) {
          res.writeHead(200, { "Content-Type": "image/svg+xml" });
          res.end(session.svg);
          return;
        }

        const remainingTime = Math.max(
          0,
          Math.ceil((config.timeout - (Date.now() - session.timestamp)) / 1000),
        );
        const commandPreview =
          session.originalContext.commandBody.length > 100
            ? session.originalContext.commandBody.substring(0, 100) + "..."
            : session.originalContext.commandBody;

        const authUrl = `http://localhost:${config.port}/captcha/${session.sessionId}`;
        const qrCode = await renderQrPngBase64(authUrl);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>二次认证</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
              .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 400px; width: 90%; }
              h1 { color: #333; margin-top: 0; font-size: 24px; text-align: center; }
              .info { background: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0; font-size: 14px; color: #4a5568; }
              .info strong { color: #2d3748; }
              .captcha-container { text-align: center; margin: 20px 0; display: none; }
              .captcha-image { border: 2px solid #e2e8f0; border-radius: 8px; background: #f7fafc; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
              .captcha-image:hover { transform: scale(1.02); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
              .captcha-image:active { transform: scale(0.98); }
              .captcha-hint { font-size: 12px; color: #718096; margin-top: 8px; }
              .input-group { margin: 20px 0; }
              input[type="text"] { width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 6px; font-size: 16px; text-align: center; letter-spacing: 4px; box-sizing: border-box; }
              input[type="text"]:focus { outline: none; border-color: #667eea; }
              button { width: 100%; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; font-weight: 600; }
              button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); }
              button:active { transform: translateY(0); }
              button:disabled { background: #cbd5e0; cursor: not-allowed; transform: none; }
              .timer { text-align: center; color: #e53e3e; font-weight: 600; margin: 10px 0; }
              .result { text-align: center; padding: 15px; border-radius: 6px; margin-top: 20px; font-weight: 600; display: none; white-space: pre-line; }
              .result.success { background: transparent; color: #111827; padding: 0; white-space: normal; }
              .result.error { background: #fed7d7; color: #742a2a; }
              .next-step { background: #ebf8ff; padding: 15px; border-radius: 6px; margin-top: 20px; font-size: 14px; color: #2b6cb0; border-left: 4px solid #3182ce; }
              .qr-section { text-align: center; margin: 20px 0; padding: 15px; background: #f7fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
              .qr-section h3 { margin: 0 0 10px 0; font-size: 14px; color: #4a5568; }
              .qr-image { display: inline-block; padding: 10px; background: white; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              .qr-link { font-size: 12px; color: #718096; word-break: break-all; margin-top: 10px; }
              body.success-mode { background: #ffffff; }
              .container.success-mode { max-width: 520px; width: 100%; box-shadow: none; border-radius: 0; padding: 70px 30px; }
              .success-view { text-align: center; }
              .success-icon { width: 110px; height: 110px; border-radius: 9999px; background: #67c23a; display: inline-flex; align-items: center; justify-content: center; margin: 0 auto 22px auto; }
              .success-icon::before { content: "✓"; color: #ffffff; font-size: 64px; line-height: 1; font-weight: 700; transform: translateY(-2px); }
              .success-title { margin: 0 0 14px 0; font-size: 34px; color: #111827; letter-spacing: 1px; }
              .success-subtitle { margin: 0; font-size: 18px; color: #6b7280; line-height: 1.7; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>🔐 二次认证</h1>
              <div class="info">
                <p>待验证操作:</p>
                <strong>${escapeHtml(commandPreview)}</strong>
              </div>
              <div class="captcha-container">
                <img class="captcha-image" src="?svg" alt="验证码" onclick="refreshCaptcha()">
                <div class="captcha-hint">🔄 点击图片刷新验证码</div>
              </div>
              <div class="qr-section">
                <h3>📱 请打开【数字身份助手APP】扫码</h3>
                <div class="qr-image">
                  <img src="data:image/png;base64,${qrCode}" alt="认证二维码" width="200" height="200">
                </div>
              </div>
              <div class="timer">⏱️ 有效期: <span id="timer">${Math.floor(remainingTime / 60)}:${String(remainingTime % 60).padStart(2, "0")}</span></div>
              <div class="input-group" style="display: none;">
                <input type="text" id="captchaInput" placeholder="输入验证码" maxlength="4" autocomplete="off">
              </div>
              <button id="verifyBtn" onclick="verifyCaptcha()" style="display: none;">验证</button>
              <div id="result" class="result"></div>
              <div id="nextStep" class="next-step" style="display: none;">
                <strong>📱 下一步：</strong><br>
                请回到聊天窗口，重新发送之前的消息命令即可执行。<br>
                <small>验证有效期为 5 分钟</small>
              </div>
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
                  document.getElementById('verifyBtn').disabled = true;
                  document.getElementById('result').textContent = '验证码已过期，请重新获取';
                  document.getElementById('result').style.display = 'block';
                  document.getElementById('result').classList.add('error');
                }
                timeLeft--;
              }

              timerInterval = setInterval(updateTimer, 1000);

              async function refreshCaptcha() {
                const img = document.querySelector('.captcha-image');
                const timerEl = document.getElementById('timer');
                const result = document.getElementById('result');

                try {
                  const response = await fetch('/captcha/${sessionId}?refresh', { method: 'GET' });
                  const data = await response.json();

                  if (data.success) {
                    img.src = '?svg&t=' + Date.now();
                    timeLeft = data.remainingTime;
                    const minutes = Math.floor(timeLeft / 60);
                    const seconds = timeLeft % 60;
                    timerEl.textContent = minutes + ':' + String(seconds).padStart(2, '0');
                    clearInterval(timerInterval);
                    timerInterval = setInterval(updateTimer, 1000);
                    result.style.display = 'none';
                    document.getElementById('captchaInput').value = '';
                  } else {
                    result.textContent = '刷新失败，请重新加载页面';
                    result.style.display = 'block';
                    result.classList.add('error');
                  }
                } catch (error) {
                  result.textContent = '刷新失败，请重新加载页面';
                  result.style.display = 'block';
                  result.classList.add('error');
                }
              }

              setTimeout(async () => {
                const result = document.getElementById('result');
                const qrSection = document.querySelector('.qr-section');
                const timerDiv = document.querySelector('.timer');
                const infoEl = document.querySelector('.info');
                const headingEl = document.querySelector('h1');
                const containerEl = document.querySelector('.container');
                const operationEl = document.querySelector('.info strong');

                try {
                  const response = await fetch('/captcha/${sessionId}?simulate-scan', { method: 'POST' });
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

              document.getElementById('captchaInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                  verifyCaptcha();
                }
              });

              async function verifyCaptcha() {
                const input = document.getElementById('captchaInput').value.trim();
                const btn = document.getElementById('verifyBtn');
                const result = document.getElementById('result');

                if (!input) {
                  result.textContent = '请输入验证码';
                  result.style.display = 'block';
                  result.classList.add('error');
                  return;
                }

                btn.disabled = true;
                btn.textContent = '验证中...';

                try {
                  const response = await fetch('/captcha/${sessionId}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: input })
                  });

                  const data = await response.json();

                  result.style.display = 'block';
                  if (data.success) {
                    result.textContent = '✅ 验证成功！';
                    result.classList.add('success');
                    result.classList.remove('error');
                    btn.textContent = '验证成功';
                    document.getElementById('captchaInput').disabled = true;
                    document.getElementById('nextStep').style.display = 'block';
                    clearInterval(timerInterval);
                  } else {
                    result.textContent = '❌ 验证码错误，请重试';
                    result.classList.add('error');
                    result.classList.remove('success');
                    btn.disabled = false;
                    btn.textContent = '验证';
                  }
                } catch (error) {
                  result.textContent = '验证失败，请重试';
                  result.style.display = 'block';
                  result.classList.add('error');
                  btn.disabled = false;
                  btn.textContent = '验证';
                }
              }

              function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
              }
            </script>
          </body>
          </html>
        `);
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const { code } = JSON.parse(body);
            const session = captchaManager.getSession(sessionId);

            if (!session) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false, error: "Session not found" }));
              return;
            }

            const verified = captchaManager.verify(sessionId, code, session.userId);
            console.log(
              `[image-captcha-auth] Verification result: ${verified}, notifyCallback exists: ${!!notifyCallback}`,
            );

            if (verified && notifyCallback) {
              try {
                console.log(`[image-captcha-auth] Calling notifyCallback for session ${sessionId}`);
                await notifyCallback(session);
                console.log(
                  `[image-captcha-auth] Notify callback completed for session ${sessionId}`,
                );
              } catch (error) {
                console.error("[image-captcha-auth] Notify callback error:", error);
              }
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: verified }));
          } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "Invalid request" }));
          }
        });
        return;
      }

      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method not allowed");
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.listen(config.port, () => {
    console.log(`[image-captcha-auth] HTTP server running on http://localhost:${config.port}`);
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[image-captcha-auth] Port ${config.port} is already in use`);
    } else {
      console.error("[image-captcha-auth] Server error:", err);
    }
  });
}
