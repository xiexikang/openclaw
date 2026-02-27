import crypto from "node:crypto";
import svgCaptcha from "svg-captcha";
import { config } from "./config.js";
import type { CaptchaSession, CaptchaConfig, PendingAuthContext } from "./types.js";

export class CaptchaManager {
  private sessions = new Map<string, CaptchaSession>();
  private verifiedUsers = new Map<string, number>();
  private config: CaptchaConfig;

  constructor(config: CaptchaConfig) {
    this.config = config;
    setInterval(() => this.cleanup(), 30000);
  }

  generate(userId: string, originalContext: PendingAuthContext): CaptchaSession {
    const captcha = svgCaptcha.create({
      size: 4,
      noise: 2,
      color: true,
      background: "#f0f0f0",
      width: 150,
      height: 50,
    });

    const sessionId = crypto.randomUUID();
    const session: CaptchaSession = {
      sessionId,
      code: captcha.text.toLowerCase(),
      svg: captcha.data,
      userId,
      timestamp: Date.now(),
      originalContext,
    };

    this.sessions.set(sessionId, session);

    if (this.config.debug) {
      console.log(`[captcha] Generated session: ${sessionId}`);
      console.log(`[captcha] User ID: ${userId}`);
      console.log(`[captcha] Total sessions: ${this.sessions.size}`);
      console.log(`[captcha] All session IDs: ${Array.from(this.sessions.keys()).join(", ")}`);
    }

    return session;
  }

  verify(sessionId: string, userInput: string, userId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    if (session.userId !== userId) {
      return false;
    }

    if (Date.now() - session.timestamp > this.config.timeout) {
      this.sessions.delete(sessionId);
      return false;
    }

    const isValid = session.code === userInput.toLowerCase().trim();

    if (isValid) {
      this.verifiedUsers.set(userId, Date.now());
      this.sessions.delete(sessionId);
    }

    return isValid;
  }

  verifyByScan(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (this.config.debug) {
      console.log(`[captcha] verifyByScan called for sessionId: ${sessionId}`);
      console.log(`[captcha] Session found: ${!!session}`);
    }

    if (!session) {
      if (this.config.debug) {
        console.log(`[captcha] Session not found in verifyByScan: ${sessionId}`);
      }
      return false;
    }

    if (Date.now() - session.timestamp > this.config.timeout) {
      this.sessions.delete(sessionId);
      if (this.config.debug) {
        console.log(`[captcha] Session expired in verifyByScan: ${sessionId}`);
      }
      return false;
    }

    this.verifiedUsers.set(session.userId, Date.now());
    this.sessions.delete(sessionId);

    if (this.config.debug) {
      console.log(`[captcha] Session verified and deleted: ${sessionId}`);
    }

    return true;
  }

  isUserVerified(userId: string): boolean {
    const verifiedTime = this.verifiedUsers.get(userId);
    if (!verifiedTime) return false;

    if (Date.now() - verifiedTime > this.config.verificationDuration) {
      this.verifiedUsers.delete(userId);
      return false;
    }

    return true;
  }

  getSession(sessionId: string): CaptchaSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  refresh(sessionId: string): CaptchaSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const captcha = svgCaptcha.create({
      size: 4,
      noise: 2,
      color: true,
      background: "#f0f0f0",
      width: 150,
      height: 50,
    });

    session.code = captcha.text.toLowerCase();
    session.svg = captcha.data;
    session.timestamp = Date.now();

    this.sessions.set(sessionId, session);
    return session;
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.timestamp > this.config.timeout) {
        this.sessions.delete(id);
      }
    }

    for (const [userId, verifiedTime] of this.verifiedUsers.entries()) {
      if (now - verifiedTime > this.config.verificationDuration) {
        this.verifiedUsers.delete(userId);
      }
    }
  }
}

export const captchaManager = new CaptchaManager(config);
