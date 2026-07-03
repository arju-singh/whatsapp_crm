// Feature module: Calling. Call logging today (routes at /api/calls); the future
// provider layer (Twilio/Plivo/Exotel/Vonage) plugs in behind a placeCall()
// interface, the same way messaging abstracts channels.
module.exports = {
  key: 'calling',
  name: 'Calling',
  description: 'Log calls and (soon) bridge agent↔contact calls via a provider.',
  core: false,
  dependsOn: ['contacts'],
  permissions: ['calls.read', 'calls.make'],
  nav: [
    { label: 'Call logs', icon: 'phone', path: '/callLogs', perm: 'calls.read' },
  ],

  // Provider columns on the shared `calls` table, owned by this module.
  migrate(db) {
    const have = db.prepare('PRAGMA table_info(calls)').all().map((r) => r.name);
    const add = (col, ddl) => { if (!have.includes(col)) db.exec(`ALTER TABLE calls ADD COLUMN ${col} ${ddl}`); };
    add('status', 'TEXT');            // initiated | ringing | connected | completed | failed
    add('provider', 'TEXT');          // log | twilio | plivo | ...
    add('provider_call_id', 'TEXT');  // external call SID, when a carrier dials
    add('recording_url', 'TEXT');     // recording link from provider status webhook
  },
};
