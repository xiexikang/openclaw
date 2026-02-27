import type { MfaConfig, DabbyConfig } from "./types.js";

export const config: MfaConfig = {
  timeout: 5 * 60 * 1000,
  verificationDuration: 2 * 60 * 1000,
  port: 18801,
  debug: true,
  sensitiveKeywords: [
    "delete",
    "remove",
    "rm",
    "unlink",
    "rmdir",
    "format",
    "wipe",
    "erase",
    "exec",
    "eval",
    "system",
    "shell",
    "bash",
    "sudo",
    "su",
    "chmod",
    "chown",
    "restart",
    "shutdown",
    "reboot",
    "gateway"
  ],
  allowlistUsers: [],
  enabledAuthMethods: ["qr-code"],
  defaultAuthMethod: "qr-code",
};

export const dabbyConfig: DabbyConfig = {
  clientId: process.env.DABBY_CLIENT_ID || "b76237dd43dc122d",
  clientSecret: process.env.DABBY_CLIENT_SECRET || "9b1e2caa-f086-44d7-b1bc-924c4733c248",
  apiBaseUrl: "https://api.dabby.com.cn/v2/api",
  tokenCacheDuration: 7000000,
  pollInterval: 2000,
};
