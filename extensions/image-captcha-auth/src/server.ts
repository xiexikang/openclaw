import crypto from "node:crypto";
import http from "node:http";
import type { CaptchaSession } from "./types.js";
import { captchaManager } from "./captcha-manager.js";
import { config } from "./config.js";

let notifyCallback: ((session: CaptchaSession) => void | Promise<void>) | null = null;

export function setNotifyCallback(callback: (session: CaptchaSession) => void | Promise<void>) {
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
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    if (url.pathname.startsWith("/captcha/")) {
      const sessionId = url.pathname.split("/")[2];

      if (req.method === "GET") {
        let session = captchaManager.getSession(sessionId);

        if (!session) {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>验证码不存在</title>
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
              .captcha-container { text-align: center; margin: 20px 0; }
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
              .result { text-align: center; padding: 15px; border-radius: 6px; margin-top: 20px; font-weight: 600; display: none; }
              .result.success { background: #c6f6d5; color: #22543d; }
              .result.error { background: #fed7d7; color: #742a2a; }
              .next-step { background: #ebf8ff; padding: 15px; border-radius: 6px; margin-top: 20px; font-size: 14px; color: #2b6cb0; border-left: 4px solid #3182ce; }
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
              <div class="timer">⏱️ 剩余时间: <span id="timer">${remainingTime}</span> 秒</div>
              <div class="input-group">
                <input type="text" id="captchaInput" placeholder="输入验证码" maxlength="4" autocomplete="off">
              </div>
              <button id="verifyBtn" onclick="verifyCaptcha()">验证</button>
              <div id="result" class="result"></div>
              <div id="nextStep" class="next-step" style="display: none;">
                <strong>📱 下一步：</strong><br>
                请回到钉钉，重新发送之前的命令即可执行。<br>
                <small>验证有效期为 ${config.verificationDuration / 1000} 秒</small>
              </div>
            </div>
            <script>
              const sessionId = "${sessionId}";
              let timeLeft = ${remainingTime};
              let timerInterval;

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
                    timerEl.textContent = timeLeft;
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

              function updateTimer() {
                const timerEl = document.getElementById('timer');
                timerEl.textContent = timeLeft;
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

            if (verified && notifyCallback) {
              try {
                await notifyCallback(session);
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
