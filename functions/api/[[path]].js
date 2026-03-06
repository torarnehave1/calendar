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

    // Fallback: check localStorage-based auth via custom header
    if (!userEmail) {
      userEmail = request.headers.get('X-User-Email');
    }

    if (!userEmail) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Forward to calendar-worker with X-User-Email header
    const headers = new Headers(request.headers);
    headers.set('X-User-Email', userEmail);

    const proxyRequest = new Request(
      `https://calendar-worker${path}${url.search}`,
      { method: request.method, headers, body: request.body }
    );
    return env.CALENDAR_WORKER.fetch(proxyRequest);
  }

  // Public endpoints — pass through directly
  const proxyRequest = new Request(
    `https://calendar-worker${path}${url.search}`,
    { method: request.method, headers: request.headers, body: request.body }
  );
  return env.CALENDAR_WORKER.fetch(proxyRequest);
}
