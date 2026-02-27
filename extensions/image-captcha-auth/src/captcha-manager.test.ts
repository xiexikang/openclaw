import { describe, it, expect, beforeEach } from "vitest";
import { CaptchaManager } from "./captcha-manager.js";
import type { CaptchaConfig } from "./types.js";

const testConfig: CaptchaConfig = {
  timeout: 5000,
  verificationDuration: 5000,
  port: 18801,
  debug: false,
  sensitiveKeywords: [],
  allowlistUsers: [],
};

describe("CaptchaManager", () => {
  let manager: CaptchaManager;

  beforeEach(() => {
    manager = new CaptchaManager(testConfig);
  });

  it("should generate a captcha session", () => {
    const session = manager.generate("user123", { commandBody: "test command" });
    expect(session.sessionId).toBeDefined();
    expect(session.code).toBeDefined();
    expect(session.svg).toBeDefined();
    expect(session.userId).toBe("user123");
  });

  it("should verify correct captcha code", () => {
    const session = manager.generate("user123", { commandBody: "test command" });
    const verified = manager.verify(session.sessionId, session.code, "user123");
    expect(verified).toBe(true);
  });

  it("should reject incorrect captcha code", () => {
    const session = manager.generate("user123", { commandBody: "test command" });
    const verified = manager.verify(session.sessionId, "wrong", "user123");
    expect(verified).toBe(false);
  });

  it("should refresh captcha code", () => {
    const session = manager.generate("user123", { commandBody: "test command" });
    const originalCode = session.code;
    const originalSvg = session.svg;

    const refreshed = manager.refresh(session.sessionId);

    expect(refreshed).not.toBeNull();
    expect(refreshed?.sessionId).toBe(session.sessionId);
    expect(refreshed?.code).not.toBe(originalCode);
    expect(refreshed?.svg).not.toBe(originalSvg);
  });

  it("should return null when refreshing non-existent session", () => {
    const refreshed = manager.refresh("non-existent");
    expect(refreshed).toBeNull();
  });

  it("should mark user as verified after successful captcha", () => {
    const session = manager.generate("user123", { commandBody: "test command" });
    manager.verify(session.sessionId, session.code, "user123");

    expect(manager.isUserVerified("user123")).toBe(true);
  });

  it("should return null for non-existent session", () => {
    const session = manager.getSession("non-existent");
    expect(session).toBeUndefined();
  });
});
