export type FeishuDomain = "feishu" | "lark" | (string & {});

export interface FeishuConfig {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  domain?: FeishuDomain;
  accounts?: Record<string, FeishuAccountConfig>;
  [key: string]: any;
}

export interface FeishuAccountConfig extends FeishuConfig {
  name?: string;
}

export type ResolvedFeishuAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  domain: FeishuDomain;
  /** Merged config (top-level defaults + account-specific overrides) */
  config: FeishuConfig;
};

export type FeishuIdType = "open_id" | "user_id" | "union_id" | "chat_id";
