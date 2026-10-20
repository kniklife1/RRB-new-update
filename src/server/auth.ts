import crypto from 'node:crypto';

export type AuthScope = 'cron' | 'admin';

export interface AuthVerificationResult {
  authorized: boolean;
  reason?: string;
  usedFallbackDevToken?: boolean;
}

/**
 * Constant-time bearer secret verification for every action endpoint.
 * Never logs or echoes the submitted token.
 * In production (NODE_ENV === 'production'), strictly requires real configured secrets
 * and refuses placeholder or fallback development tokens.
 */
export function verifyEndpointAuth(
  authorizationHeader: string | undefined,
  requiredScope: AuthScope,
  env: Record<string, string | undefined> = process.env
): AuthVerificationResult {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return {
      authorized: false,
      reason: 'Missing or malformed Authorization: Bearer <token> header.',
    };
  }

  const submittedToken = authorizationHeader.slice('Bearer '.length).trim();
  if (!submittedToken || submittedToken.length < 8) {
    return {
      authorized: false,
      reason: 'Bearer token is empty or shorter than minimum required length.',
    };
  }

  const isPlaceholder = (v: string) =>
    !v || v.startsWith('YOUR_') || v.startsWith('MY_') || v.startsWith('GENERATE_');

  const rawCronSecret = (env.CRON_AUTH_TOKEN || '').trim();
  const rawAdminSecret = (env.ADMIN_AUTH_TOKEN || '').trim();
  const isProd = env.NODE_ENV === 'production' && env.ALLOW_DEV_FALLBACK_TOKENS !== 'true';

  if (isProd) {
    const validSecrets: string[] = [];
    if (requiredScope === 'cron') {
      if (!isPlaceholder(rawCronSecret)) validSecrets.push(rawCronSecret);
      if (!isPlaceholder(rawAdminSecret)) validSecrets.push(rawAdminSecret);
    } else {
      if (!isPlaceholder(rawAdminSecret)) validSecrets.push(rawAdminSecret);
    }

    if (validSecrets.length === 0) {
      return {
        authorized: false,
        reason: `Production secret for scope '${requiredScope}' is not configured.`,
      };
    }

    for (const expected of validSecrets) {
      const bufA = Buffer.from(submittedToken, 'utf8');
      const bufB = Buffer.from(expected, 'utf8');
      if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
        return { authorized: true, usedFallbackDevToken: false };
      }
    }

    return {
      authorized: false,
      reason: `Invalid bearer token for scope '${requiredScope}'.`,
    };
  }

  // Non-production preview/development mode: allow fallback dev tokens if secrets are placeholders
  const effectiveCronSecret = !isPlaceholder(rawCronSecret)
    ? rawCronSecret
    : 'rrb-monitor-dev-cron-secret-2026';
  const effectiveAdminSecret = !isPlaceholder(rawAdminSecret)
    ? rawAdminSecret
    : 'rrb-monitor-dev-admin-secret-2026';

  const allowedSecrets =
    requiredScope === 'cron'
      ? [effectiveCronSecret, effectiveAdminSecret]
      : [effectiveAdminSecret];

  for (const expected of allowedSecrets) {
    const bufA = Buffer.from(submittedToken, 'utf8');
    const bufB = Buffer.from(expected, 'utf8');
    if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
      return {
        authorized: true,
        usedFallbackDevToken: isPlaceholder(rawCronSecret) && isPlaceholder(rawAdminSecret),
      };
    }
  }

  return {
    authorized: false,
    reason: `Invalid bearer token for scope '${requiredScope}'.`,
  };
}
