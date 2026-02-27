export interface CaptchaSession {
  sessionId: string;
  code: string;
  svg: string;
  userId: string;
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
  pendingExecutionId?: string;
  triggerType?: string;
}

export interface CaptchaConfig {
  timeout: number;
  verificationDuration: number;
  port: number;
  debug: boolean;
  sensitiveKeywords: string[];
  allowlistUsers: string[];
}
