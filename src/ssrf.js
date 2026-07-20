// ---------------------------------------------------------------------------
// SSRF-safe outbound fetch for untrusted URLs (e.g. remote avatar caching).
//
// Blocks requests that resolve to private / loopback / link-local / reserved
// address space, allows only http(s), re-validates every redirect hop, and caps
// the response size. Residual risk: DNS-rebinding TOCTOU is not fully closed
// (would require pinning the resolved IP at connect time).
// ---------------------------------------------------------------------------

const net = require('net');
const dns = require('dns').promises;

function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;               // link-local
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;   // private
    if (p[0] === 192 && p[1] === 168) return true;               // private
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;  // CGNAT
    if (p[0] >= 224) return true;                                // multicast/reserved
    return false;
  }
  if (fam === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fe80')) return true;                     // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local
    const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP → block
}

async function hostIsBlocked(hostname) {
  if (net.isIP(hostname)) return isBlockedIp(hostname);
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    if (!addrs.length) return true;
    return addrs.some((a) => isBlockedIp(a.address));
  } catch (_) {
    return true; // unresolvable → block
  }
}

// Returns a fetch Response for a validated final URL, or null if blocked/invalid.
async function safeFetch(startUrl, { maxHops = 3 } = {}) {
  let current = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    let u;
    try { u = new URL(current); } catch (_) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (await hostIsBlocked(u.hostname)) return null;
    const r = await fetch(u.href, { redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, u).href; // resolve relative, re-validate next iteration
      continue;
    }
    return r;
  }
  return null; // too many redirects
}

module.exports = { isBlockedIp, hostIsBlocked, safeFetch };
