const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function onRequest({ request, env, params }) {
  if (!env.CALENDAR_WORKER) {
    return jsonResponse({ error: 'CALENDAR_WORKER binding missing' }, 500);
  }

  const url = new URL(request.url);
  const path = `/api/${params.path.join('/')}`;

  // A browser-supplied X-User-Email is never forwarded (2026-10-22): calls to calendar-worker over
  // this binding are trusted to carry a VERIFIED e-mail, so the only one we set is the session's.
  // Without a session the request goes on with its X-API-Token, which calendar-worker verifies.
  const forwarded = new Headers(request.headers);
  forwarded.delete('X-User-Email');

  // Admin endpoints and auth-status require authentication
  if (path.startsWith('/api/admin/') || path.startsWith('/api/auth/')) {
    // Verify auth via AUTH_WORKER
    const cookie = request.headers.get('cookie') || '';
    let userEmail = null;

    if (env.AUTH_WORKER) {
      try {
        const authRes = await env.AUTH_WORKER.fetch(
          'https://auth.vegvisr.org/auth/openauth/session',
          { method: 'GET', headers: { cookie } }
        );
        if (authRes.ok) {
          const authData = await authRes.json();
          if (authData?.success && authData?.subject?.email) {
            userEmail = authData.subject.email;
          }
        }
      } catch {}
    }

    if (!userEmail && !request.headers.get('X-API-Token')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Session e-mail when there is one; otherwise calendar-worker resolves X-API-Token.
    const headers = forwarded;
    if (userEmail) headers.set('X-User-Email', userEmail);

    const proxyRequest = new Request(
      `https://calendar-worker${path}${url.search}`,
      { method: request.method, headers, body: request.body }
    );
    return env.CALENDAR_WORKER.fetch(proxyRequest);
  }

  // Public endpoints and /api/calendar/* — pass through, minus any X-User-Email
  const proxyRequest = new Request(
    `https://calendar-worker${path}${url.search}`,
    { method: request.method, headers: forwarded, body: request.body }
  );
  return env.CALENDAR_WORKER.fetch(proxyRequest);
}
