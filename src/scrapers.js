// =============================================================
// Lead scrapers — Google Maps + Justdial.
//
// Both reuse the puppeteer that ships with whatsapp-web.js. Each
// returns an array of { name, phone, address, city, source, source_url }.
// Caller is responsible for:
//   1. Deduping against vendors.phone
//   2. Inserting into `leads` table (status='lead', not vendor)
//
// Both scrapers are best-effort. Google may rate-limit / change DOM at any
// time. Run sparingly, manually-triggered, never on a cron.
// =============================================================
const path = require('path');
const settings = require('./settings');

let puppeteer = null;
function getPuppeteer() {
  if (puppeteer) return puppeteer;
  try { puppeteer = require('puppeteer'); return puppeteer; }
  catch (_) {}
  try { puppeteer = require('whatsapp-web.js/node_modules/puppeteer'); return puppeteer; }
  catch (e) { throw new Error('puppeteer_not_available: ' + e.message); }
}

async function withBrowser(fn, { headless = true } = {}) {
  const pp = getPuppeteer();
  const browser = await pp.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });
  try {
    return await fn(browser);
  } finally {
    try { await browser.close(); } catch (_) {}
  }
}

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

function normPhone(s) {
  // Sources sometimes pack several numbers into one field ("+91 …; +91 …").
  // Take the first before stripping separators, else they merge into junk.
  const first = String(s || '').split(/[;,/\n]| or /i)[0];
  const d = first.replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return '';
  if (d.length === 10) return '91' + d;
  return d;
}

// ---- Google Maps -------------------------------------------------------
async function scrapeGoogleMaps({ query, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    const url = 'https://www.google.com/maps/search/' + encodeURIComponent(query);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await SLEEP(3000);

    // Scroll the results panel so more cards load
    const feedSelector = 'div[role="feed"]';
    try {
      await page.waitForSelector(feedSelector, { timeout: 15000 });
    } catch (_) {
      return { results: [], error: 'feed_not_found — Google may be blocking the request' };
    }
    let prevCount = 0;
    for (let i = 0; i < 8; i++) {
      const links = await page.$$('a.hfpxzc');
      if (links.length >= max || links.length === prevCount) break;
      prevCount = links.length;
      await page.evaluate((sel) => {
        const f = document.querySelector(sel); if (f) f.scrollTop = f.scrollHeight;
      }, feedSelector);
      await SLEEP(2000);
    }

    const cards = await page.$$('a.hfpxzc');
    const results = [];
    for (let i = 0; i < Math.min(cards.length, max); i++) {
      try {
        await cards[i].click();
        await page.waitForSelector('h1.DUwDvf', { timeout: 8000 });
        await SLEEP(800);
        const data = await page.evaluate(() => {
          const text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
          const name = text('h1.DUwDvf');
          // Phone & address are in buttons with data-item-id="phone:tel:…" / data-item-id="address"
          let phone = '', address = '';
          document.querySelectorAll('button[data-item-id]').forEach((b) => {
            const id = b.getAttribute('data-item-id') || '';
            if (id.startsWith('phone:')) {
              const aria = b.getAttribute('aria-label') || '';
              phone = aria.replace(/^Phone:\s*/i, '').trim();
              if (!phone) phone = id.replace(/^phone:tel:/, '');
            }
            if (id === 'address') {
              const aria = b.getAttribute('aria-label') || '';
              address = aria.replace(/^Address:\s*/i, '').trim();
            }
          });
          const rating = text('div.F7nice span');
          const category = text('button[jsaction*="category"]');
          const url = location.href;
          return { name, phone, address, rating, category, url };
        });
        if (data.name) {
          results.push({
            name: data.name,
            phone: normPhone(data.phone),
            phone_raw: data.phone || '',
            address: data.address,
            city: extractCityFromAddress(data.address),
            category: data.category,
            rating: data.rating,
            source: 'google_maps',
            source_url: data.url,
          });
        }
      } catch (_) { /* skip card */ }
    }
    return { results };
  });
}

function extractCityFromAddress(addr) {
  if (!addr) return '';
  // Best-effort: pick the second-to-last comma-separated chunk that's not a pin code.
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^\d{6}$/.test(p)) continue;
    if (/^india$/i.test(p)) continue;
    if (/(pradesh|haryana|punjab|bihar|delhi|kerala|gujarat|rajasthan|uttar|west bengal|tamil nadu|karnataka|maharashtra|madhya|odisha|assam|jharkhand|telangana|andhra)/i.test(p)) continue;
    return p;
  }
  return '';
}

// ---- Justdial ----------------------------------------------------------
// Justdial is fairly hostile to automation. This is a best-effort scrape
// of the public listing page; expect some fields to be missing.
async function scrapeJustdial({ query, city, max = 30 } = {}) {
  if (!query || !city) throw new Error('query_and_city_required');
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    // Justdial URL pattern: https://www.justdial.com/{City}/{Query}
    const url = `https://www.justdial.com/${encodeURIComponent(city)}/${encodeURIComponent(query)}`;
    try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); }
    catch (_) { return { results: [], error: 'navigation_failed' }; }
    await SLEEP(3500);

    // Scroll to load more listings
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await SLEEP(1500);
    }

    const data = await page.evaluate((maxN) => {
      const cards = Array.from(document.querySelectorAll('div.resultbox, div[class*="result"]')).slice(0, maxN);
      const out = [];
      cards.forEach((card) => {
        const nameEl = card.querySelector('h2 a, h3 a, .resultbox_title_anchor, [class*="title"]');
        const phoneEl = card.querySelector('[class*="callcontent"], [class*="phone"], a[href^="tel:"]');
        const addrEl = card.querySelector('[class*="address"], [class*="locatn"], [class*="cont_sw_addr"]');
        if (!nameEl) return;
        const name = nameEl.textContent.trim();
        let phone = '';
        if (phoneEl) {
          phone = (phoneEl.textContent || '').trim();
          if (!phone && phoneEl.href && phoneEl.href.startsWith('tel:')) phone = phoneEl.href.slice(4);
        }
        const address = addrEl ? addrEl.textContent.trim() : '';
        if (name) out.push({ name, phone, address });
      });
      return out;
    }, max);

    return {
      results: data.map((r) => ({
        name: r.name,
        phone: normPhone(r.phone),
        phone_raw: r.phone || '',
        address: r.address,
        city,
        category: query,
        source: 'justdial',
        source_url: url,
      })),
    };
  });
}

// ---- OpenStreetMap (Overpass + Nominatim) ------------------------------
// 100% free public API. No browser, never captcha'd. The most reliable
// source — use this first. Finds named businesses (shops, clinics, offices,
// vets, etc.) whose name matches the query, optionally within a city.
const OSM_UA = 'whatsapp-crm-leadfinder/1.0';

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Build an Overpass name regex from the query, dropping generic words so
// "pet shop" still matches "Bhati Pet Shop" and "4 Pets".
function osmKeywordRegex(query) {
  const stop = new Set(['shop', 'shops', 'store', 'stores', 'service', 'services',
    'in', 'near', 'the', 'and', 'dealer', 'dealers', 'center', 'centre', 'best', 'top', 'new']);
  const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let kept = words.filter((w) => !stop.has(w) && w.length > 1);
  if (!kept.length) kept = words;
  if (!kept.length) kept = [String(query || '')];
  // Whole-word match (with optional trailing 's') so "pet" matches "Pet"/"Pets"
  // but NOT "Petrol"/"Peter". [^A-Za-z] acts as a word boundary on both sides.
  return kept.map((w) => `(^|[^A-Za-z])${escapeRe(w)}s?([^A-Za-z]|$)`).join('|');
}

function osmAddr(t) {
  const parts = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'],
    t['addr:city'], t['addr:state'], t['addr:postcode']].filter(Boolean);
  return parts.join(', ') || t['addr:full'] || '';
}

async function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function scrapeOSM({ query, city, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  // 1. Geocode the city to a bounding box (falls back to all of India).
  let bbox = '6.5,68.0,37.5,97.5'; // south,west,north,east — India
  if (city) {
    try {
      const geo = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city)}`,
        { headers: { 'User-Agent': OSM_UA } }, 20000);
      const gj = await geo.json();
      if (gj && gj[0] && gj[0].boundingbox) {
        const [s, n, w, e] = gj[0].boundingbox; // [south, north, west, east]
        bbox = `${s},${w},${n},${e}`;
      }
    } catch (_) { /* keep India fallback */ }
  }
  // 2. Query Overpass for named businesses matching the query in that box.
  const q = osmKeywordRegex(query);
  const cap = Math.min(Number(max) || 30, 200);
  const oq = `[out:json][timeout:25];(` +
    `node["name"~"${q}",i]["shop"](${bbox});` +
    `node["name"~"${q}",i]["amenity"](${bbox});` +
    `node["name"~"${q}",i]["office"](${bbox});` +
    `node["name"~"${q}",i]["craft"](${bbox});` +
    `node["name"~"${q}",i]["healthcare"](${bbox});` +
    `way["name"~"${q}",i]["shop"](${bbox});` +
    `way["name"~"${q}",i]["amenity"](${bbox});` +
    `);out center ${cap};`;
  let data;
  try {
    const resp = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': OSM_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(oq),
    }, 35000);
    if (!resp.ok) return { results: [], error: 'overpass_http_' + resp.status };
    data = await resp.json();
  } catch (e) {
    return { results: [], error: 'overpass_failed: ' + e.message };
  }
  const results = (data.elements || []).map((el) => {
    const t = el.tags || {};
    const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile || '';
    const address = osmAddr(t);
    return {
      name: t.name,
      phone: normPhone(phone),
      phone_raw: phone,
      address,
      city: t['addr:city'] || city || extractCityFromAddress(address),
      category: t.shop || t.amenity || t.craft || t.office || t.healthcare || query,
      source: 'openstreetmap',
      source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    };
  }).filter((r) => r.name);
  return { results: results.slice(0, Number(max) || 30) };
}

// ---- Generic directory scraper -----------------------------------------
// Powers IndiaMART / Bing Maps / Yellow Pages. Instead of brittle per-site
// CSS, it harvests structured data that most directories publish anyway:
// JSON-LD LocalBusiness blocks, schema.org microdata, and tel: links with
// their nearest heading. Survives most layout changes. Still best-effort.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function scrapeGeneric({ url, source, city = '', category = '', max = 30, scrolls = 4, waitMs = 3500 } = {}) {
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 900 });
    try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); }
    catch (_) { return { results: [], error: 'navigation_failed' }; }
    await SLEEP(waitMs);
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, 1400));
      await SLEEP(1200);
    }
    const raw = await page.evaluate((maxN) => {
      const out = [];
      const seen = new Set();
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      const push = (o) => {
        if (!o || !o.name) return;
        const key = (o.name + '|' + (o.phone || '')).toLowerCase().trim();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(o);
      };

      // 1) JSON-LD (incl. @graph and itemListElement nesting)
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        let json;
        try { json = JSON.parse(s.textContent); } catch (_) { return; }
        const stack = Array.isArray(json) ? json.slice() : [json];
        let guard = 0;
        while (stack.length && guard++ < 5000) {
          const o = stack.shift();
          if (!o || typeof o !== 'object') continue;
          if (Array.isArray(o['@graph'])) stack.push(...o['@graph']);
          if (Array.isArray(o.itemListElement)) stack.push(...o.itemListElement.map((e) => (e && e.item) || e));
          const type = [].concat(o['@type'] || []).join(',').toLowerCase();
          if (/business|organization|store|restaurant|professional|place|medical|hospital|clinic|vet|dentist|pharmacy/.test(type) && o.name) {
            let address = '';
            if (typeof o.address === 'string') address = o.address;
            else if (o.address && typeof o.address === 'object') {
              address = [o.address.streetAddress, o.address.addressLocality, o.address.addressRegion, o.address.postalCode].filter(Boolean).join(', ');
            }
            const lc = (o.address && typeof o.address === 'object' && o.address.addressLocality) || '';
            push({ name: String(o.name).trim(), phone: o.telephone || o.phone || '', address, city: lc });
          }
        }
      });

      // 2) schema.org microdata
      document.querySelectorAll('[itemtype*="LocalBusiness"], [itemtype*="Organization"]').forEach((el) => {
        const name = txt(el.querySelector('[itemprop="name"]'));
        if (!name) return;
        push({
          name,
          phone: txt(el.querySelector('[itemprop="telephone"]')),
          address: txt(el.querySelector('[itemprop="address"]')),
          city: '',
        });
      });

      // 3) tel: links → nearest heading as the business name
      document.querySelectorAll('a[href^="tel:"]').forEach((a) => {
        let phone = '';
        try { phone = decodeURIComponent(a.getAttribute('href').slice(4)).trim(); } catch (_) { phone = a.getAttribute('href').slice(4); }
        const box = a.closest('li, article, .result, [class*="card"], [class*="result"], [class*="listing"], [class*="resultbox"]') || a.parentElement;
        if (!box) return;
        const h = box.querySelector('h1,h2,h3,h4,[class*="title"] a,[class*="title"],[class*="name"],a[class*="name"]');
        const name = txt(h);
        if (!name) return;
        push({ name, phone, address: txt(box.querySelector('[class*="address"],address,[class*="locat"]')), city: '' });
      });

      return out.slice(0, maxN);
    }, Number(max) || 30);

    // If we got nothing, check whether the site served a block / captcha page
    // so the UI can say "blocked" instead of a misleading "0 results".
    if (!raw.length) {
      const blocked = await page.evaluate(() => {
        const t = (document.title || '').toLowerCase();
        const b = (document.body ? document.body.innerText : '').toLowerCase().slice(0, 800);
        return /attention required|just a moment|access denied|are you a robot|unusual traffic|verify you are human|been blocked|captcha/.test(t + ' ' + b);
      });
      if (blocked) return { results: [], error: source + '_blocked_or_captcha' };
    }

    return {
      results: raw.map((r) => ({
        name: r.name,
        phone: normPhone(r.phone),
        phone_raw: r.phone || '',
        address: r.address || '',
        city: r.city || city || extractCityFromAddress(r.address || ''),
        category,
        source,
        source_url: url,
      })),
    };
  });
}

function scrapeIndiamart({ query, city, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  const ss = encodeURIComponent(city ? `${query} ${city}` : query);
  return scrapeGeneric({ url: `https://dir.indiamart.com/search.mp?ss=${ss}`, source: 'indiamart', city, category: query, max, scrolls: 5 });
}

function scrapeBingMaps({ query, city, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  const q = encodeURIComponent(city ? `${query} in ${city}` : query);
  return scrapeGeneric({ url: `https://www.bing.com/maps?q=${q}`, source: 'bing_maps', city, category: query, max, scrolls: 6, waitMs: 4500 });
}

function scrapeYellowpages({ query, city, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  const url = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(query)}&geo_location_terms=${encodeURIComponent(city || '')}`;
  return scrapeGeneric({ url, source: 'yellowpages', city, category: query, max, scrolls: 3 });
}

// ---- Foursquare Places API ---------------------------------------------
// Proper REST API (no scraping → never blocked). Free developer tier, no
// card. User pastes their key in Settings → Lead-finder APIs. Great for
// free-text "pet shop near Hisar" and returns phone + address directly.
async function scrapeFoursquare({ query, city, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  const key = settings.get('foursquare_api_key');
  if (!key) throw new Error('foursquare_api_key_not_set — add a free key in Settings → Lead-finder APIs');
  const limit = Math.min(Number(max) || 30, 50);
  const near = city ? `&near=${encodeURIComponent(city)}` : '';
  const fields = 'name,location,tel,website,categories';

  // The current (2025+) Foursquare Places API; fall back to the legacy v3 host
  // since key/host pairing depends on when the developer account was created.
  const attempts = [
    { url: `https://places-api.foursquare.com/places/search?query=${encodeURIComponent(query)}${near}&limit=${limit}&fields=${fields}`,
      headers: { Authorization: `Bearer ${key}`, 'X-Places-Api-Version': '2025-06-17', Accept: 'application/json' } },
    { url: `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(query)}${near}&limit=${limit}&fields=${fields}`,
      headers: { Authorization: key, Accept: 'application/json' } },
  ];
  let data = null, lastStatus = 0;
  for (const a of attempts) {
    try {
      const resp = await fetchWithTimeout(a.url, { headers: a.headers }, 25000);
      lastStatus = resp.status;
      if (resp.ok) { data = await resp.json(); break; }
    } catch (_) { /* try next */ }
  }
  if (!data) return { results: [], error: 'foursquare_http_' + lastStatus };

  const results = (data.results || []).map((p) => {
    const loc = p.location || {};
    const address = loc.formatted_address || [loc.address, loc.locality, loc.region, loc.postcode].filter(Boolean).join(', ');
    return {
      name: p.name,
      phone: normPhone(p.tel || ''),
      phone_raw: p.tel || '',
      address,
      city: loc.locality || city || extractCityFromAddress(address),
      category: (p.categories && p.categories[0] && p.categories[0].name) || query,
      source: 'foursquare',
      source_url: p.website || 'https://foursquare.com',
    };
  }).filter((r) => r.name);
  return { results };
}

// ---- HERE Discover API -------------------------------------------------
// Free tier ~1000 requests/day, no card. Geocode the city, then run a
// place "discover" query around it. Returns phone + address directly.
async function scrapeHere({ query, city, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  const key = settings.get('here_api_key');
  if (!key) throw new Error('here_api_key_not_set — add a free key in Settings → Lead-finder APIs');
  let at = { lat: 28.6139, lng: 77.2090 }; // Delhi fallback
  if (city) {
    try {
      const g = await fetchWithTimeout(`https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(city)}&apiKey=${key}`, {}, 20000);
      const gj = await g.json();
      if (gj.items && gj.items[0] && gj.items[0].position) at = gj.items[0].position;
    } catch (_) { /* keep fallback */ }
  }
  const limit = Math.min(Number(max) || 30, 100);
  const url = `https://discover.search.hereapi.com/v1/discover?at=${at.lat},${at.lng}&q=${encodeURIComponent(query)}&limit=${limit}&apiKey=${key}`;
  let data;
  try {
    const resp = await fetchWithTimeout(url, {}, 25000);
    if (!resp.ok) return { results: [], error: 'here_http_' + resp.status };
    data = await resp.json();
  } catch (e) {
    return { results: [], error: 'here_failed: ' + e.message };
  }
  const results = (data.items || []).map((it) => {
    let phone = '';
    if (Array.isArray(it.contacts)) {
      for (const c of it.contacts) {
        if (Array.isArray(c.phone) && c.phone[0] && c.phone[0].value) { phone = c.phone[0].value; break; }
      }
    }
    const address = (it.address && it.address.label) || '';
    return {
      name: it.title,
      phone: normPhone(phone),
      phone_raw: phone,
      address,
      city: (it.address && it.address.city) || city || extractCityFromAddress(address),
      category: (it.categories && it.categories[0] && it.categories[0].name) || query,
      source: 'here',
      source_url: 'https://www.here.com',
    };
  }).filter((r) => r.name);
  return { results };
}

// ---- TomTom Search API (alternative to HERE) ---------------------------
// Free tier ~2500 requests/day, no card. Fuzzy free-text POI search that
// returns phone + address directly. Biased to the configured region.
async function scrapeTomtom({ query, city, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  const key = settings.get('tomtom_api_key');
  if (!key) throw new Error('tomtom_api_key_not_set — add a free key in Settings → Lead-finder APIs');
  const country = (settings.get('default_region') || 'IN').toUpperCase();
  const limit = Math.min(Number(max) || 30, 100);

  // Geocode the city first so we can constrain the POI search to a radius
  // around it — otherwise the fuzzy text search scatters across nearby towns.
  let geo = '';
  if (city) {
    try {
      const g = await fetchWithTimeout(
        `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(city)}.json?key=${key}&limit=1&countrySet=${country}`,
        { headers: { Accept: 'application/json' } }, 20000);
      const gj = await g.json();
      const pos = gj.results && gj.results[0] && gj.results[0].position;
      if (pos) geo = `&lat=${pos.lat}&lon=${pos.lon}&radius=25000`;
    } catch (_) { /* fall back to plain search */ }
  }
  const url = `https://api.tomtom.com/search/2/poiSearch/${encodeURIComponent(query)}.json?key=${key}&limit=${limit}&countrySet=${country}${geo}`;
  let data;
  try {
    const resp = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 25000);
    if (!resp.ok) return { results: [], error: 'tomtom_http_' + resp.status };
    data = await resp.json();
  } catch (e) {
    return { results: [], error: 'tomtom_failed: ' + e.message };
  }
  const results = (data.results || []).filter((r) => r.poi).map((r) => {
    const addr = r.address || {};
    const phone = r.poi.phone || '';
    return {
      name: r.poi.name,
      phone: normPhone(phone),
      phone_raw: phone,
      address: addr.freeformAddress || '',
      city: addr.municipality || city || extractCityFromAddress(addr.freeformAddress || ''),
      category: (r.poi.categories && r.poi.categories[0]) || query,
      source: 'tomtom',
      source_url: r.poi.url ? ('https://' + r.poi.url) : 'https://www.tomtom.com',
    };
  }).filter((r) => r.name);
  return { results };
}

// ---- Registry + dispatcher ---------------------------------------------
// Single source of truth used by the route (dispatch) and the frontend
// (dropdown). `needsCity` flips on per-source validation.
// `requiresKey` → the settings key that must be configured for the source to
// appear in the dropdown (free API tiers the user activates with their own key).
const SOURCES = [
  { id: 'openstreetmap', label: 'OpenStreetMap (free · reliable)', needsCity: false, note: 'Free public API — never blocked, no captcha, no key needed. Best coverage in cities; thinner in small towns. Add a city for accuracy.' },
  { id: 'foursquare', label: 'Foursquare (API · free tier)', needsCity: false, requiresKey: 'foursquare_api_key', note: 'Reliable REST API — never blocked. Returns phone + address. Needs a free Foursquare key in Settings → Lead-finder APIs.' },
  { id: 'here', label: 'HERE Maps (API · free tier)', needsCity: false, requiresKey: 'here_api_key', note: 'Reliable REST API — ~1000 free lookups/day. Returns phone + address. Needs a free HERE key in Settings → Lead-finder APIs.' },
  { id: 'tomtom', label: 'TomTom (API · free tier)', needsCity: false, requiresKey: 'tomtom_api_key', note: 'Reliable REST API — ~2500 free lookups/day. Free-text search, returns phone + address. Needs a free TomTom key in Settings → Lead-finder APIs.' },
  { id: 'google_maps', label: 'Google Maps (rich data)', needsCity: false, note: 'Richest data, but Google may show a captcha after a few runs — wait and retry.' },
  { id: 'justdial', label: 'Justdial (best-effort)', needsCity: true, note: 'Requires a city. Best-effort — Justdial often blocks bots, so results vary.' },
  { id: 'indiamart', label: 'IndiaMART (best-effort)', needsCity: false, note: 'India B2B directory. Best-effort — IndiaMART masks most phone numbers behind a click, so phones are often missing.' },
  { id: 'bing_maps', label: 'Bing Maps (best-effort)', needsCity: false, note: 'Best-effort — Bing renders results in a panel that often exposes no scrapable data.' },
  { id: 'yellowpages', label: 'Yellow Pages (best-effort)', needsCity: true, note: 'Best-effort — Yellow Pages is usually behind Cloudflare and may block the scrape.' },
];

// Sources visible in the UI: always-on ones plus key-based ones whose key is set.
function availableSources() {
  return SOURCES
    .filter((s) => !s.requiresKey || !!settings.get(s.requiresKey))
    .map(({ requiresKey, ...rest }) => rest);
}

async function runScrape({ source = 'google_maps', query, city, max = 30 } = {}) {
  if (!query) throw new Error('query_required');
  const meta = SOURCES.find((s) => s.id === source);
  if (!meta) throw new Error('unknown_source: ' + source);
  if (meta.needsCity && !city) throw new Error(`city_required_for_${source}`);
  const n = Number(max) || 30;
  switch (source) {
    case 'justdial': return scrapeJustdial({ query, city, max: n });
    case 'openstreetmap': return scrapeOSM({ query, city, max: n });
    case 'foursquare': return scrapeFoursquare({ query, city, max: n });
    case 'here': return scrapeHere({ query, city, max: n });
    case 'tomtom': return scrapeTomtom({ query, city, max: n });
    case 'indiamart': return scrapeIndiamart({ query, city, max: n });
    case 'bing_maps': return scrapeBingMaps({ query, city, max: n });
    case 'yellowpages': return scrapeYellowpages({ query, city, max: n });
    case 'google_maps':
    default: return scrapeGoogleMaps({ query: city ? `${query} in ${city}` : query, max: n });
  }
}

module.exports = {
  SOURCES, availableSources, runScrape,
  scrapeGoogleMaps, scrapeJustdial, scrapeOSM, scrapeFoursquare, scrapeHere, scrapeTomtom,
  scrapeIndiamart, scrapeBingMaps, scrapeYellowpages,
};
