## 目标与可行性结论

- 可以做到：不修改 OpenClaw core 源码，仅通过 extensions 扩展“强制门禁”危险操作；当用户触发“删除/执行命令/改写文件”等高风险动作时，系统先返回验证码链接，验证通过后才允许继续执行。

- 关键机制：使用插件 typed hook `before_tool_call` 阻断高风险 tool（`exec`/`apply_patch`/`write`/`edit`/`process`/`gateway`/`nodes` 等），并用插件 HTTP handler 在网关上提供验证码页面。

- 重要限制（设计取舍）：插件无法直接让“被阻断的那一次工具调用”自动继续执行（没有安全的方式重放内置工具调用）；最稳妥的 UX 是“验证成功后，请重新发送刚才的操作”。

## 方案概览

- 以现有扩展 [image-captcha-auth](file:///g:/www-xxk/openclaw/extensions/image-captcha-auth) 为基础增强（避免从零造轮子）：
  - 复用 `CaptchaManager` 生成/校验验证码与验证有效期。

  - 把当前“用户自觉走 /runcaptcha”的模式升级为“全局强制门禁”。

  - 把当前独立 `http.createServer()` 改为 `api.registerHttpHandler()`，让验证码页面挂载到 Gateway 的同一端口，对外可访问。

## 具体实现步骤（只改 extension，不改 core）

1. **扩展配置与状态模型**

- 在扩展的 `config.ts`/schema 中加入：
  - `publicBaseUrl`：验证码页面对外可访问的 base（默认 `http://localhost:<gateway.port>`；生产建议配置成实际域名或 Tailscale/Funnel 地址）。

  - `timeoutMs`、`verificationDurationMs`：验证码有效期与“已验证”窗口。

  - `sensitiveTools`：默认包含 `exec`,`apply_patch`,`write`,`edit`,`process`,`gateway`,`nodes`。

  - `execSensitiveRegex/keywords`：判定 `exec.command` 是否属于删除/破坏性命令（rm/del/Remove-Item/rmdir 等）。

  - `applyPatchSensitive`：若 patch 中包含 `*** Delete File:` 或 `*** Move to:` 则视为敏感。

- 内存状态（Map）：
  - `verifiedUntilBySessionKey: Map<string, number>`

  - `activeCaptchaBySessionKey: Map<string, {sessionId, createdAt}>`

  - `captchaSession -> sessionKey` 的反查（用于 HTTP POST 校验后写入 verified）。

1. **在 before_tool_call 做强制门禁**

- `api.on("before_tool_call", ...)`：
  - 读取 `ctx.sessionKey`（没有则退化为全阻断或仅日志）。

  - 若 sessionKey 在验证窗口内：放行。

  - 否则判断是否敏感：
    - toolName 在 `sensitiveTools` 且满足参数判定（例如 exec 的 command 命中删除关键字；apply_patch 包含删除/移动标记；write/edit 一律认为敏感或按路径/扩展名白名单细化）。

  - 敏感且未验证：
    - 生成 captcha session（复用 `CaptchaManager.generate`，originalContext 至少包含 `toolName + params 摘要 + timestamp`）。

    - 组装 URL：`${publicBaseUrl}/plugins/<pluginId>/captcha/<sessionId>`（实际 path 见下一步 HTTP handler）。

    - 返回 `{ block: true, blockReason: "🔐 该操作需要二次认证... 链接... 验证后请重试" }`。

1. **用 Gateway 插件 HTTP handler 提供验证码页面**

- `api.registerHttpHandler((req,res)=>boolean)`：
  - 处理 `GET /plugins/<pluginId>/captcha/<sessionId>`：输出 HTML（可复用现有 `server.ts` 的页面模板与 `?svg` 逻辑）。

  - 处理 `GET ...?svg=1`：输出 SVG。

  - 处理 `POST /plugins/<pluginId>/captcha/<sessionId>`：校验验证码；成功则 `verifiedUntilBySessionKey.set(sessionKey, now + verificationDurationMs)` 并删除 session。

  - 额外提供 `GET /plugins/<pluginId>/health` 便于自测。

1. **修复与收敛现有 image-captcha-auth 里的残留实现**

- 移除/弃用独立 `startHttpServer()`（避免端口冲突与 localhost 不可达）。

- 修复 `captcha-manager.ts` 中 `PendingAuthContext` 未导入的问题；补齐类型引用。

- `command.ts` 的 `/verify` 当前 `getAllSessionsForUser()` 恒返回空；要么实现为“按 sessionKey 验证”，要么明确移除该命令，仅保留 web 链接流程（更符合需求）。

1. **验证与回归检查**

- 新增/更新扩展的单元测试（vitest）：
  - 未验证时，`before_tool_call` 对 `exec` + `rm` 命令返回 blockReason，且生成 sessionId。

  - HTTP POST 校验成功后，verified 窗口内同样 tool call 放行。

  - `apply_patch` 包含 `*** Delete File:` 时触发门禁。

- 本地手工验证流程：在任意对话里让 agent 触发 `exec rm/...` 或 `apply_patch` 删除；确认收到链接；打开链接输入验证码；再次发送删除请求应成功执行。

## 交付物

- 扩展 [extensions/image-captcha-auth](file:///g:/www-xxk/openclaw/extensions/image-captcha-auth) 更新：全局门禁 + 网关内置验证码页面 + 配置项。

- 对应测试用例，确保不改 core 也能稳定工作。
