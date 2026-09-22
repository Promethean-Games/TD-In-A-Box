const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const DEFAULT_TTL_SECONDS = 86_400;

interface CloudflareIceServerResponse {
  iceServers?: unknown;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  const turnKeyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID')?.trim();
  const apiToken = Deno.env.get('CLOUDFLARE_API_TOKEN')?.trim();

  if (!turnKeyId || !apiToken) {
    console.error('[turn-ice] Missing Cloudflare TURN configuration.');
    return jsonResponse(500, { error: 'TURN service is not configured.' });
  }

  let ttl = DEFAULT_TTL_SECONDS;
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).ttl === 'number') {
      const requestedTtl = Math.trunc((body as Record<string, number>).ttl);
      if (requestedTtl > 0) {
        ttl = requestedTtl;
      }
    }
  } catch {
    ttl = DEFAULT_TTL_SECONDS;
  }

  try {
    const cloudflareResponse = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttl })
      }
    );

    if (!cloudflareResponse.ok) {
      console.error('[turn-ice] Cloudflare TURN credential request failed.', {
        status: cloudflareResponse.status
      });
      return jsonResponse(502, { error: 'TURN credential generation failed.' });
    }

    const payload = (await cloudflareResponse.json()) as CloudflareIceServerResponse;
    if (!Array.isArray(payload.iceServers) || payload.iceServers.length === 0) {
      console.error('[turn-ice] Cloudflare TURN credential response was missing iceServers.');
      return jsonResponse(502, { error: 'TURN credential response was invalid.' });
    }

    return jsonResponse(200, { iceServers: payload.iceServers });
  } catch (error) {
    console.error('[turn-ice] Unexpected TURN credential failure.', {
      message: error instanceof Error ? error.message : 'unknown error'
    });
    return jsonResponse(502, { error: 'TURN credential generation failed.' });
  }
});
