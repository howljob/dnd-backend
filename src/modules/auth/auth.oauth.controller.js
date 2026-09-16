const oauthService = require('./auth.oauth.service');

const KNOWN_PROVIDERS = ['google', 'vk'];

function normalizeProvider(raw) {
  const provider = String(raw || '').toLowerCase();
  return KNOWN_PROVIDERS.includes(provider) ? provider : null;
}

/**
 * Прочитать одну cookie без cookie-parser.
 */
function readCookie(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.OAUTH_CALLBACK_BASE || '').startsWith('https://'),
    path: '/api/auth/oauth'
  };
}

function listProviders(req, res) {
  return res.status(200).json({
    ok: true,
    providers: oauthService.listProviders()
  });
}

function startOAuth(req, res) {
  const provider = normalizeProvider(req.params.provider);

  if (!provider || !oauthService.isProviderEnabled(provider)) {
    return res.status(404).json({
      ok: false,
      message: 'OAuth provider is not configured'
    });
  }

  try {
    const { url, cookie } = oauthService.buildAuthorizationRequest(provider);

    res.cookie(cookie.name, cookie.value, {
      ...stateCookieOptions(),
      maxAge: cookie.maxAgeMs
    });

    return res.redirect(url);
  } catch (error) {
    console.error('[oauth] start failed:', error);
    return res.redirect(oauthService.buildErrorRedirect('oauth_start_failed'));
  }
}

async function oauthCallback(req, res) {
  const provider = normalizeProvider(req.params.provider);

  if (!provider || !oauthService.isProviderEnabled(provider)) {
    return res.redirect(oauthService.buildErrorRedirect('provider_not_configured'));
  }

  const cookieName = oauthService.getStateCookieName(provider);
  const stateCookieValue = readCookie(req, cookieName);
  res.clearCookie(cookieName, stateCookieOptions());

  try {
    const redirectUrl = await oauthService.handleCallback(provider, req.query || {}, stateCookieValue, {
      userAgent: req.get('user-agent') || '',
      ipAddress: req.ip || req.socket?.remoteAddress || ''
    });

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error(`[oauth] ${provider} callback failed:`, error.message);
    return res.redirect(oauthService.buildErrorRedirect('oauth_failed'));
  }
}

module.exports = {
  listProviders,
  startOAuth,
  oauthCallback
};
