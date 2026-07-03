// Feature module: Customer Support (tickets). Backed by /api/tickets. Tickets can
// be auto-opened from inbound messages when both this and a channel are enabled.
module.exports = {
  key: 'support',
  name: 'Customer Support',
  description: 'Support tickets with SLA, priority, and assignment.',
  core: false,
  dependsOn: ['contacts'],
  permissions: ['tickets.read', 'tickets.write'],
  nav: [
    { label: 'Tickets', icon: 'ticket', path: '/tickets', perm: 'tickets.read' },
  ],
};
