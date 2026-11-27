# PRINTELYX — Gmail OAuth Setup Guide

**Date:** 2026-11-27
**Purpose:** Connect shopkeeper Gmail accounts for automatic payment reconciliation.

## Overview

Shopkeepers connect the Gmail account that receives payment notifications from their bank or payment provider. Printelyx monitors these notifications (read-only) and matches them against pending customer orders.

**Printelyx NEVER sends email on the shopkeeper's behalf.** The only scope requested is `gmail.readonly`.

## Google Cloud Project Setup

### 1. Create/Select a Project
- Go to https://console.cloud.google.com/
- Create a new project or select an existing one.

### 2. Enable Gmail API
- APIs & Services → Library
- Search "Gmail API" → Enable

### 3. Configure OAuth Consent Screen
- APIs & Services → OAuth consent screen
- User type: **External** (or Internal for Google Workspace)
- App name: Printelyx
- Support email: your email
- Scopes: Add `gmail.readonly` (https://www.googleapis.com/auth/gmail.readonly)
- Authorized domains: `printelyx.cc.cd`
- Test users: Add the shopkeeper's Gmail address(es)

### 4. Create OAuth Client
- APIs & Services → Credentials → Create Credentials → OAuth client ID
- Application type: **Web application**
- Authorized JavaScript origins: `https://printelyx.cc.cd`
- Authorized redirect URIs: `https://printelyx.cc.cd/api/v1/shops/me/gmail/callback`
- Copy the **Client ID** and **Client Secret**

### 5. Set Environment Variables
In Vercel (Project Settings → Environment Variables):
```
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx
GOOGLE_REDIRECT_URI=https://printelyx.cc.cd/api/v1/shops/me/gmail/callback
```

## OAuth Flow

1. Shopkeeper goes to `/shop/settings` → "Connect Gmail"
2. Redirected to `GET /api/v1/shops/me/gmail/connect`
3. Redirected to Google consent screen (scope: gmail.readonly)
4. Shopkeeper grants access
5. Google redirects to `GET /api/v1/shops/me/gmail/callback?code=...&state=shopId:nonce`
6. Server validates state (CSRF), exchanges code for tokens
7. Refresh token is AES-256-GCM encrypted + stored in `ShopGmailConnection`
8. Redirected to `/shop/settings?gmail=connected`

## Security

- **State validation:** Random nonce in cookie + state param, validated on callback (CSRF protection)
- **Token encryption:** Refresh token encrypted with `PAYMENT_ENCRYPTION_KEY` (AES-256-GCM)
- **No access token storage:** Access tokens are refreshed on demand and used immediately
- **Tenant isolation:** The `shopId` is embedded in the state and validated against the authenticated owner
- **Revocation:** On disconnect, the Google token is revoked + the connection record is deleted
- **No email sending:** Only `gmail.readonly` scope is requested

## Google Verification

For production use with more than 100 users, Google requires OAuth consent screen verification:
- Submit for verification at APIs & Services → OAuth consent screen → Publish App
- Required: privacy policy URL, terms of service URL, app demonstration video
- Processing time: 4-6 weeks
- Until verified: only test users can grant access (max 100)

## Environment Variables

| Variable | Required | Server-only | Description |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | ✅ | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | ✅ | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Yes | ✅ | `https://printelyx.cc.cd/api/v1/shops/me/gmail/callback` |
| `PAYMENT_ENCRYPTION_KEY` | Yes | ✅ | AES-256-GCM key for refresh token encryption |

## Troubleshooting

| Problem | Fix |
|---|---|
| "Google OAuth is not configured" | Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in Vercel |
| "redirect_uri_mismatch" | Ensure the redirect URI in Google Cloud matches `GOOGLE_REDIRECT_URI` |
| "invalid_client" | Check client ID/secret are correct |
| "access_denied" | User is not in test users list (before verification) |
| "Google did not return a refresh token" | Revoke access in Google Account settings, then reconnect with `prompt: consent` |
| Token refresh fails | The user may have revoked access — disconnect + reconnect |
