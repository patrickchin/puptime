export { AccountStore } from './account-store';

export default {
  fetch(request: Request): Response {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return Response.json({ service: 'puptime-api', status: 'ok', protocolVersion: 1 });
    }
    // Account data is internal until the identity phase supplies authenticated routing.
    return Response.json({ error: 'not_found' }, { status: 404 });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
