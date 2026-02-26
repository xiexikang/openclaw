# OpenClaw MFA Auth Plugin

A multi-factor authentication plugin for OpenClaw with pluggable authentication providers. Currently supports QR code authentication with extensible design for future auth methods (image captcha, SMS, email).

## Features

- **Pluggable Auth Providers**: Easy-to-extend architecture for adding new authentication methods
- **QR Code Authentication**: Current default method with automatic scan simulation (10s delay)
- **Sensitive Command Protection**: Intercepts sensitive operations requiring verification
- **Multi-Channel Support**: Works with Discord, Telegram, Slack, WhatsApp, Signal, and Feishu
- **User Verification State**: 2-minute verification window after successful auth
- **Automatic Cleanup**: Periodic cleanup of expired sessions

## Architecture

### Plugin Structure

```
extensions/mfa-auth/
├── index.ts                      # Plugin entry point
├── package.json                  # NPM configuration
├── openclaw.plugin.json         # Plugin metadata
├── README.md                     # Documentation
├── src/
│   ├── types.ts                 # TypeScript type definitions
│   ├── config.ts                # Plugin configuration
│   ├── auth-manager.ts          # Core authentication manager
│   ├── providers/               # Authentication providers
│   │   ├── base.ts              # Base provider interface
│   │   └── qr-code.ts           # QR code auth provider
│   ├── server.ts                # HTTP server for auth pages
│   └── qr.ts                    # QR code generation utilities
```

### Core Components

#### AuthManager

Manages authentication sessions and user verification state:

- Session generation and tracking
- Provider registration and lookup
- User verification state management
- Automatic cleanup of expired data

#### AuthMethodProvider Interface

Base interface for all authentication providers:

```typescript
interface AuthMethodProvider {
  readonly methodType: AuthMethodType;
  readonly name: string;
  readonly description: string;

  initialize(session: AuthSession): Promise<void>;
  verify(sessionId: string, userInput?: string): Promise<AuthResult>;
  cleanup(sessionId: string): void;
  generateAuthPage(session: AuthSession, authUrl: string): Promise<string>;
}
```

#### QR Code Provider

Implements QR code authentication with:

- QR code generation using `qrcode-terminal`
- 10-second automatic scan simulation
- Custom HTML page with countdown timer
- Success feedback display

## Authentication Flow

1. User sends sensitive command
2. Plugin intercepts and blocks the command
3. Authentication session is generated
4. User receives verification link via chat
5. User opens link → QR code page displayed
6. Wait 10 seconds → automatic scan simulation
7. Success page displayed → notification sent back
8. User re-sends command → execution allowed

## Configuration

Edit `src/config.ts` to customize:

```typescript
{
  timeout: 5 * 60 * 1000,           // Auth session timeout: 5 minutes
  verificationDuration: 2 * 60 * 1000, // Verified user grace period: 2 minutes
  port: 18801,                        // HTTP server port
  debug: true,                        // Debug logging
  sensitiveKeywords: [                 // Sensitive command keywords
    "delete", "remove", "rm", "unlink", "rmdir",
    "format", "wipe", "erase",
    "exec", "eval", "system", "shell", "bash",
    "sudo", "su", "chmod", "chown",
    "restart", "shutdown", "reboot", "gateway"
  ],
  allowlistUsers: [],                 // Users exempt from verification
  enabledAuthMethods: ["qr-code"],     // Enabled auth methods
  defaultAuthMethod: "qr-code",        // Default auth method
}
```

## Adding New Authentication Providers

### Step 1: Create Provider File

Create `src/providers/my-provider.ts`:

```typescript
import { BaseAuthProvider } from "./base.js";
import type { AuthSession, AuthResult } from "../types.js";

export class MyAuthProvider extends BaseAuthProvider {
  readonly methodType = "my-method" as const;
  readonly name = "My Authentication";
  readonly description = "Custom authentication method";

  async initialize(session: AuthSession): Promise<void> {
    // Initialize your auth method (send SMS, generate captcha, etc.)
  }

  async verify(sessionId: string, userInput?: string): Promise<AuthResult> {
    // Verify user input
    return { success: true };
  }

  generateAuthPage(session: AuthSession, authUrl: string): Promise<string> {
    // Return HTML for your auth page
    return `<html>...</html>`;
  }
}
```

### Step 2: Register Provider

Import and register in `index.ts`:

```typescript
import { MyAuthProvider } from "./src/providers/my-provider.js";

export default function register(api: OpenClawPluginApi) {
  authManager.registerProvider(new MyAuthProvider());
  // ...
}
```

### Step 3: Update Config

Add to `src/config.ts`:

```typescript
enabledAuthMethods: ["qr-code", "my-method"],
defaultAuthMethod: "qr-code",
```

## Future Provider Examples

### Image Captcha Provider

```typescript
class ImageCaptchaAuthProvider extends BaseAuthProvider {
  readonly methodType = "image-captcha" as const;
  // Uses svg-captcha to generate verification codes
}
```

### SMS Provider

```typescript
class SmsAuthProvider extends BaseAuthProvider {
  readonly methodType = "sms" as const;
  // Sends SMS codes via SMS gateway
}
```

### Email Provider

```typescript
class EmailAuthProvider extends BaseAuthProvider {
  readonly methodType = "email" as const;
  // Sends email codes via SMTP
}
```

## API Endpoints

- `GET /health` - Health check
- `GET /mfa-auth/:sessionId` - Display authentication page
- `POST /mfa-auth/verify` - Verify authentication session

## Installation

1. Navigate to `extensions/mfa-auth`
2. Run `npm install` (or `pnpm install`)
3. Start OpenClaw gateway

## Testing

Test the QR code authentication:

1. Send a sensitive command via a supported channel
2. Click the verification link
3. Wait 10 seconds for automatic scan
4. See success message
5. Re-send the command to execute

## Troubleshooting

- Port already in use: Change `port` in `src/config.ts`
- Sessions not found: Check debug logs for session IDs
- Notifications not sending: Verify channel configuration in OpenClaw config

## License

Same as OpenClaw project.
