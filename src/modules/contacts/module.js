// Core module: Contacts — the universal person/record entity. Every industry
// pack builds on top of this (a contact can be a lead, customer, vendor, tenant,
// buyer, patient, student...). Always on. Routes already live at /api/contacts
// (see server.js) and are migrated to org-scoping in place, so this manifest
// only declares the module's identity, permissions, and navigation.
module.exports = {
  key: 'contacts',
  name: 'Contacts',
  description: 'People and organizations you do business with.',
  core: true,
  permissions: ['contacts.read', 'contacts.write', 'contacts.delete'],
  nav: [
    { label: 'Contacts', icon: 'users', path: '/contacts', perm: 'contacts.read' },
  ],
};
