// Feature module: Sales Pipeline (deals, stages, companies, forecasting).
// Backed by the existing /api/deals, /api/stages, /api/companies routes. An org
// that only wants messaging can leave this off and never see a pipeline.
module.exports = {
  key: 'deals',
  name: 'Sales Pipeline',
  description: 'Deals, stages, companies, and forecasting.',
  core: false,
  permissions: ['deals.read', 'deals.write', 'reports.read'],
  nav: [
    { label: 'Deals', icon: 'kanban', path: '/deals', perm: 'deals.read' },
    { label: 'Reports', icon: 'chart', path: '/reports', perm: 'reports.read' },
  ],
};
