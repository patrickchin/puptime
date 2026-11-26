const releases = 'https://github.com/patrickchin/puptime/releases';

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  try {
    const latest = await fetch(`${releases}/latest`, { method: 'HEAD', redirect: 'manual' });
    const tag = latest.headers.get('location')?.replace(`${releases}/tag/`, '');
    if (latest.status !== 302 || !tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
      throw new Error('Android release unavailable');
    }
    const filename = `Puptime-${tag.slice(1)}.apk`;
    const apk = await fetch(`${releases}/download/${tag}/${filename}`, { method: request.method });
    const length = apk.headers.get('content-length');
    if (apk.status !== 200 || !length || !/^[1-9]\d*$/.test(length)) {
      throw new Error('Android APK unavailable');
    }
    return new Response(apk.body, { headers: {
      'content-type': 'application/vnd.android.package-archive',
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': length,
      'cache-control': 'public, max-age=300',
    } });
  } catch {
    return new Response('The Android download is temporarily unavailable. Please try again later.', {
      status: 502,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
