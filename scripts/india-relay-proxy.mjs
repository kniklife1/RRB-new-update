/**
 * Lightweight, zero-dependency HTTPS Relay for the Unified RRB Portal
 * (`https://rrb.indianrailways.gov.in/`).
 *
 * Why this exists:
 * The CRIS/NIC firewall at 103.110.246.98:443 (`rrb.indianrailways.gov.in`)
 * drops TCP SYN packets from non-Indian cloud datacenter IPs (such as default
 * US-hosted GitHub Actions `ubuntu-latest` runners), causing `UND_ERR_CONNECT_TIMEOUT`.
 *
 * Deployment Options:
 * 1. Deploy this script in an Indian cloud region (e.g., Google Cloud Run `asia-south1` Mumbai,
 *    AWS Lambda `ap-south-1` Mumbai, or an India-based VPS) and set its HTTPS URL as
 *    `RRB_PORTAL_MIRROR_URL` in GitHub Repository Secrets/Variables.
 * 2. Or register an India-based self-hosted GitHub Actions runner and set repository variable
 *    `RUNNER_LABELS` to `["self-hosted", "linux", "india"]`.
 */
import http from 'node:http';

const UPSTREAM_PORTAL_URL = 'https://rrb.indianrailways.gov.in/';
const PORT = Number(process.env.PORT || 8080);
const RELAY_AUTH_TOKEN = (process.env.RRB_PORTAL_MIRROR_AUTH_TOKEN || '').trim();

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, upstream: UPSTREAM_PORTAL_URL }));
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  if (RELAY_AUTH_TOKEN) {
    const provided = (req.headers['x-relay-auth'] || '').toString().trim();
    if (provided !== RELAY_AUTH_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Unauthorized relay request' }));
      return;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const upstreamRes = await fetch(UPSTREAM_PORTAL_URL, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    const body = await upstreamRes.text();
    res.writeHead(upstreamRes.status, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    clearTimeout(timer);
    const errorObj = err;
    const causeCode = errorObj?.cause?.code || '';
    const causeMsg = errorObj?.cause?.message || '';
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'Upstream RRB portal fetch failed from relay host',
        message: errorObj?.message || 'Unknown error',
        causeCode,
        causeMsg,
      })
    );
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[rrb-india-relay] Listening on 0.0.0.0:${PORT} -> proxying ${UPSTREAM_PORTAL_URL}`
  );
});
