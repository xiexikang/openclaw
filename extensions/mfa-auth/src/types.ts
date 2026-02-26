export type AuthMethodType = "qr-code" | "image-captcha" | "sms" | "email";

export interface AuthSession {
  sessionId: string;
  userId: string;
  authMethod: AuthMethodType;
  timestamp: number;
  originalContext: PendingAuthContext;
}

export interface PendingAuthContext {
  sessionKey: string;
  senderId: string;
  commandBody: string;
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: number;
  toolName: string;
  toolParams: Record<string, unknown>;
  timestamp: number;
}

export interface MfaConfig {
  timeout: number;
  verificationDuration: number;
  port: number;
  debug: boolean;
  sensitiveKeywords: string[];
  allowlistUsers: string[];
  enabledAuthMethods: AuthMethodType[];
  defaultAuthMethod: AuthMethodType;
}

export interface AuthMethodProvider {
  readonly methodType: AuthMethodType;
  readonly name: string;
  readonly description: string;

  initialize(session: AuthSession): Promise<void>;
  verify(sessionId: string, userInput?: string): Promise<AuthResult>;
  cleanup(sessionId: string): void;
  generateAuthPage(session: AuthSession, authUrl: string): Promise<string>;
}

export interface AuthResult {
  success: boolean;
  error?: string;
}
