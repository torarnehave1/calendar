export async function onRequest({ request, env }) {
  if (!env.AUTH_WORKER) {
    return new Response('AUTH_WORKER binding is missing', { status: 500 });
  }

  const cookie = request.headers.get('cookie') || '';
  const response = await env.AUTH_WORKER.fetch(
    'https://auth.vegvisr.org/auth/openauth/session',
    {
      method: 'GET',
      headers: { cookie },
    }
  );

  return response;
}
