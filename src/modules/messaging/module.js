// Core module: Messaging — the channel-agnostic send/receive layer. Individual
// channels (WhatsApp, Email, SMS, Telegram...) are separate feature modules that
// plug into this. Always on; the existing /api/messages routes back it.
module.exports = {
  key: 'messaging',
  name: 'Messaging',
  description: 'Unified inbox and outbound messaging across channels.',
  core: true,
  permissions: ['messages.read', 'messages.send'],
  nav: [
    { label: 'Inbox', icon: 'chat', path: '/inbox', perm: 'messages.read' },
  ],
};
