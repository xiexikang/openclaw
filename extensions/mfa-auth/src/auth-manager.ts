import crypto from "node:crypto";
import { config } from "./config.js";
import type { AuthSession, AuthMethodProvider, AuthResult, PendingAuthContext } from "./types.js";

export class AuthManager {
  private sessions = new Map<string, AuthSession>();
  public verifiedUsers = new Map<string, number>();
  private providers = new Map<string, AuthMethodProvider>();
  private config = config;
  private pendingExecutions = new Map<string, { sessionId: string; timestamp: number }>();

  constructor() {
    setInterval(() => this.cleanup(), 30000);
  }

  registerProvider(provider: AuthMethodProvider): void {
    this.providers.set(provider.methodType, provider);
  }

  getProvider(methodType: string): AuthMethodProvider | undefined {
    return this.providers.get(methodType);
  }

  generateSession(
    userId: string,
    originalContext: PendingAuthContext,
    authMethod: string = this.config.defaultAuthMethod,
    extraFields?: Partial<AuthSession>,
  ): AuthSession | null {
    const provider = this.getProvider(authMethod);
    if (!provider) {
      console.error(`[mfa-auth] Auth provider not found: ${authMethod}`);
      return null;
    }

    const sessionId = crypto.randomUUID();
    const session: AuthSession = {
      sessionId,
      userId,
      authMethod: authMethod as any,
      timestamp: Date.now(),
      originalContext,
      ...extraFields,
    };

    this.sessions.set(sessionId, session);

    if (this.config.debug) {
      console.log(`[mfa-auth] Generated session: ${sessionId}`);
      console.log(`[mfa-auth] User ID: ${userId}`);
      console.log(`[mfa-auth] Auth method: ${authMethod}`);
      console.log(`[mfa-auth] Total sessions: ${this.sessions.size}`);
    }

    return session;
  }

  async verifySession(sessionId: string, userInput?: string): Promise<AuthResult> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { success: false, error: "Session not found" };
    }

    if (Date.now() - session.timestamp > this.config.timeout) {
      this.sessions.delete(sessionId);
      return { success: false, error: "Session expired" };
    }

    const provider = this.getProvider(session.authMethod);
    if (!provider) {
      return { success: false, error: "Provider not found" };
    }

    const result = await provider.verify(sessionId, userInput);

    if (result.success) {
      this.verifiedUsers.set(session.userId, Date.now());
      this.sessions.delete(sessionId);

      if (this.config.debug) {
        console.log(`[mfa-auth] Session verified and deleted: ${sessionId}`);
        console.log(`[mfa-auth] User ${session.userId} marked as verified`);
      }
    }

    return result;
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

  getSession(sessionId: string): AuthSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  updateAuthStatus(
    sessionId: string,
    status: "pending" | "scanned" | "verified" | "failed" | "expired",
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.authStatus = status;
      if (this.config.debug) {
        console.log(`[mfa-auth] Session ${sessionId} status updated to: ${status}`);
      }
    }
  }

  getCertToken(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.certToken;
  }

  cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.timestamp > this.config.timeout) {
        const provider = this.getProvider(session.authMethod);
        if (provider) {
          provider.cleanup(id);
        }
        this.sessions.delete(id);
        cleanedCount++;
      }
    }

    for (const [userId, verifiedTime] of this.verifiedUsers.entries()) {
      if (now - verifiedTime > this.config.verificationDuration) {
        this.verifiedUsers.delete(userId);
        cleanedCount++;
      }
    }

    for (const [userId, pending] of this.pendingExecutions.entries()) {
      if (now - pending.timestamp > 10 * 60 * 1000) {
        this.pendingExecutions.delete(userId);
        cleanedCount++;
      }
    }

    if (this.config.debug && cleanedCount > 0) {
      console.log(`[mfa-auth] Cleanup: removed ${cleanedCount} expired entries`);
    }
  }

  registerPendingExecution(userId: string, sessionId: string): void {
    this.pendingExecutions.set(userId, { sessionId, timestamp: Date.now() });
    if (this.config.debug) {
      console.log(`[mfa-auth] Registered pending execution for user ${userId}: ${sessionId}`);
    }
  }

  getAndClearPendingExecution(userId: string): string | null {
    const pending = this.pendingExecutions.get(userId);
    if (pending) {
      this.pendingExecutions.delete(userId);
      if (this.config.debug) {
        console.log(
          `[mfa-auth] Cleared pending execution for user ${userId}: ${pending.sessionId}`,
        );
      }
      return pending.sessionId;
    }
    return null;
  }

  hasPendingExecution(userId: string): boolean {
    const pending = this.pendingExecutions.get(userId);
    if (!pending) return false;
    const now = Date.now();
    return now - pending.timestamp < 10 * 60 * 1000;
  }

  markUserVerified(userId: string): void {
    this.verifiedUsers.set(userId, Date.now());
    if (this.config.debug) {
      console.log(`[mfa-auth] Marked user ${userId} as verified`);
    }
  }
}

export const authManager = new AuthManager();
