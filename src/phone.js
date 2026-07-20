// ---------------------------------------------------------------------------
// Phone-number normalization — single source of truth.
//
// Previously duplicated (with subtle drift) across auth/users/vendors/
// suppressions. Centralized here so a change to the rule happens in one place.
// Call sites pass their own country code to preserve their historical behavior.
// ---------------------------------------------------------------------------

const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '91';

/**
 * Reduce a phone string to digits only, stripping leading zeros.
 * @param {*} p raw input
 * @returns {string} digits (may be empty)
 */
function digitsOnly(p) {
  return String(p == null ? '' : p).replace(/\D/g, '').replace(/^0+/, '');
}

/**
 * Normalize to country+national digits. A bare 10-digit national number is
 * prefixed with `countryCode`; anything else is returned digits-only.
 * @param {*} p raw input
 * @param {string} [countryCode] country dialing code without '+' (default env DEFAULT_COUNTRY_CODE or '91')
 * @returns {string} normalized digits (may be empty)
 */
function normalizePhone(p, countryCode = DEFAULT_COUNTRY_CODE) {
  const d = digitsOnly(p);
  if (!d) return '';
  return d.length === 10 ? `${countryCode}${d}` : d;
}

module.exports = { digitsOnly, normalizePhone, DEFAULT_COUNTRY_CODE };
