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
  const d = String(s || '').replace(/\D/g, '').replace(/^0+/, '');
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

module.exports = { scrapeGoogleMaps, scrapeJustdial };
