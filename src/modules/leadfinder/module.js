// Feature module: Lead Finder (scrapers). Discovers businesses from Google Maps /
// Justdial and stages them as leads (routes at /api/leads). Promote → contact.
module.exports = {
  key: 'leadfinder',
  name: 'Lead Finder',
  description: 'Scrape business listings and promote them into contacts.',
  core: false,
  dependsOn: ['contacts'],
  permissions: ['leads.read', 'leads.write'],
  nav: [
    { label: 'Find leads', icon: 'globe', path: '/leads', perm: 'leads.read' },
  ],
};
