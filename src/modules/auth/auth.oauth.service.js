/**
 * T3.4: вход через Google и VK ID (OAuth 2.0 / OAuth 2.1 + PKCE).
 *
 * Ключей в репозитории нет: провайдер включается, только когда в .env заданы
 * его CLIENT_ID и SECRET (см. docs/oauth-setup.md). Обмен кода на профиль —
 * прямыми HTTPS-запросами (fetch), без SDK.
 *
 * Защита от CSRF: перед редиректом к провайдеру генерируется nonce (state),
 * он сохраняется в httpOnly-cookie браузера и сверяется в коллбэке.
 * Для VK ID дополнительно PKCE (code_verifier/code_challenge, S256).
 */
const bcrypt = require('bcrypt');
const { randomBytes, randomUUID, createHash } = require('crypto');
const pool = require('../../db/pool');
const env = require('../../config/env');
const authService = require('./auth.service');

const STATE_COOKIE_PREFIX = 'dnd_oauth_';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 минут на прохождение у провайдера

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function isGoogleEnabled() {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

function isVkEnabled() {
  return Boolean(env.vkidClientId && env.vkidClientSecret);
}

function listProviders() {
  const providers = [];
  if (isGoogleEnabled()) providers.push('google');
  if (isVkEnabled()) providers.push('vk');
  return providers;
}

function isProviderEnabled(provider) {
  return listProviders().includes(provider);
}

function getCallbackBase() {
  return String(env.oauthCallbackBase || '').replace(/\/+$/, '');
}

function buildRedirectUri(provider) {
  return `${getCallbackBase()}/api/auth/oauth/${provider}/callback`;
}

function getStateCookieName(provider) {
  return `${STATE_COOKIE_PREFIX}${provider}`;
}

/**
 * Собрать URL авторизации у провайдера + данные для state-cookie.
 */
function buildAuthorizationRequest(provider) {
  const nonce = randomBytes(16).toString('hex');
  const cookiePayload = { nonce, ts: Date.now() };
  let url;

  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: buildRedirectUri('google'),
      response_type: 'code',
      scope: 'openid email profile',
      state: nonce,
      prompt: 'select_account'
    });
    url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  } else if (provider === 'vk') {
    // VK ID (OAuth 2.1) требует PKCE
    const verifier = base64UrlEncode(randomBytes(32));
    const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
    cookiePayload.verifier = verifier;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.vkidClientId,
      redirect_uri: buildRedirectUri('vk'),
      state: nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'email'
    });
    url = `https://id.vk.com/authorize?${params.toString()}`;
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    url,
    cookie: {
      name: getStateCookieName(provider),
      value: base64UrlEncode(Buffer.from(JSON.stringify(cookiePayload), 'utf8')),
      maxAgeMs: STATE_TTL_MS
    }
  };
}

function parseStateCookie(rawValue) {
  if (!rawValue) return null;

  try {
    const normalized = String(rawValue).replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload || typeof payload.nonce !== 'string') return null;
    if (typeof payload.ts === 'number' && Date.now() - payload.ts > STATE_TTL_MS) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const summary = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(`${url.split('?')[0]}: ${summary}`);
  }

  return data;
}

/**
 * Google: code → access_token → профиль { email, emailVerified, name, avatarUrl }.
 */
async function exchangeGoogleCode(code) {
  const tokenData = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: buildRedirectUri('google')
    }).toString()
  });

  if (!tokenData?.access_token) {
    throw new Error('Google token exchange returned no access_token');
  }

  const profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });

  return {
    email: typeof profile?.email === 'string' ? profile.email.trim().toLowerCase() : '',
    emailVerified: profile?.email_verified !== false,
    name: typeof profile?.name === 'string' ? profile.name.trim() : ''
  };
}

/**
 * VK ID: code (+PKCE verifier, device_id) → access_token → профиль.
 */
async function exchangeVkCode(code, verifier, deviceId, nonce) {
  const tokenData = await fetchJson('https://id.vk.com/oauth2/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier || '',
      client_id: env.vkidClientId,
      device_id: deviceId || '',
      redirect_uri: buildRedirectUri('vk'),
      state: nonce
    }).toString()
  });

  if (!tokenData?.access_token) {
    throw new Error('VK token exchange returned no access_token');
  }

  const info = await fetchJson('https://id.vk.com/oauth2/user_info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.vkidClientId,
      access_token: tokenData.access_token
    }).toString()
  });

  const vkUser = info?.user || {};
  const email = typeof vkUser.email === 'string' && vkUser.email.trim()
    ? vkUser.email.trim().toLowerCase()
    : (typeof tokenData.email === 'string' ? tokenData.email.trim().toLowerCase() : '');
  const name = [vkUser.first_name, vkUser.last_name]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .trim();

  return {
    email,
    emailVerified: true, // VK отдаёт только подтверждённую у себя почту
    name
  };
}

/**
 * Связка по email: найти существующий аккаунт или создать новый
 * (почта от провайдера считается подтверждённой — email_confirmed_at = now()).
 */
async function findOrCreateUserByOAuthProfile(profile) {
  const existing = await pool.query(
    `SELECT id, email, display_name, role, language, account_status, bio, avatar_url, email_confirmed_at
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [profile.email]
  );

  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    if (user.account_status !== 'active') {
      const error = new Error('Account is not active');
      error.statusCode = 403;
      throw error;
    }

    // Провайдер подтвердил владение почтой — засчитываем подтверждение.
    if (!user.email_confirmed_at) {
      await pool.query(
        'UPDATE users SET email_confirmed_at = now(), updated_at = now() WHERE id = $1',
        [user.id]
      );
      user.email_confirmed_at = new Date();
    }

    return user;
  }

  const displayName = (profile.name || profile.email.split('@')[0] || 'Adventurer').slice(0, 255);
  // Пароль аккаунту нужен по схеме, но входить по нему нельзя — случайные 64 байта.
  const passwordHash = await bcrypt.hash(randomUUID() + randomBytes(32).toString('hex'), authService.SALT_ROUNDS);

  const inserted = await pool.query(
    `INSERT INTO users (
      email,
      password_hash,
      role,
      display_name,
      language,
      telegram_chat_id,
      email_notifications_enabled,
      telegram_notifications_enabled,
      email_confirmed_at
    )
    VALUES ($1, $2, 'user', $3, 'ru', NULL, true, false, now())
    RETURNING id, email, display_name, role, language, account_status, bio, avatar_url, email_confirmed_at`,
    [profile.email, passwordHash, displayName]
  );

  return inserted.rows[0];
}

/**
 * Полный коллбэк: проверка state, обмен кода, вход/создание аккаунта, JWT.
 * @returns {Promise<string>} URL редиректа на фронт (токен во fragment)
 */
async function handleCallback(provider, query, stateCookieValue, meta) {
  if (!isProviderEnabled(provider)) {
    throw new Error(`Provider not configured: ${provider}`);
  }

  if (query.error) {
    throw new Error(`Provider returned error: ${query.error}`);
  }

  const statePayload = parseStateCookie(stateCookieValue);
  const state = typeof query.state === 'string' ? query.state : '';
  if (!statePayload || !state || statePayload.nonce !== state) {
    throw new Error('OAuth state mismatch (possible CSRF or expired attempt)');
  }

  const code = typeof query.code === 'string' ? query.code : '';
  if (!code) {
    throw new Error('OAuth callback without code');
  }

  const profile = provider === 'google'
    ? await exchangeGoogleCode(code)
    : await exchangeVkCode(code, statePayload.verifier, query.device_id, statePayload.nonce);

  if (!profile.email) {
    throw new Error('Provider did not return an email');
  }

  if (!profile.emailVerified) {
    throw new Error('Provider email is not verified');
  }

  const user = await findOrCreateUserByOAuthProfile(profile);
  const { token } = await authService.createSessionForUser(user, meta);

  const base = String(env.frontendUrl || '').replace(/\/+$/, '');
  return `${base}/#oauth?token=${encodeURIComponent(token)}`;
}

function buildErrorRedirect(reason) {
  const base = String(env.frontendUrl || '').replace(/\/+$/, '');
  return `${base}/#oauth?error=${encodeURIComponent(reason || 'oauth_failed')}`;
}

module.exports = {
  listProviders,
  isProviderEnabled,
  buildAuthorizationRequest,
  handleCallback,
  buildErrorRedirect,
  getStateCookieName
};
