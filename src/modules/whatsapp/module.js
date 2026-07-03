// Feature module: WhatsApp channel. Wraps the whatsapp-web.js bridge (QR link,
// rate-limited queue, delivery/read acks) that currently lives under /api/wa.
// Declared as a module so an org can turn WhatsApp on/off and so a future Twilio
// WhatsApp transport can be swapped behind the same messaging layer.
module.exports = {
  key: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send and receive WhatsApp via a linked device.',
  core: false,
  dependsOn: ['messaging'],
  permissions: ['whatsapp.read', 'whatsapp.send', 'whatsapp.admin'],
  nav: [
    { label: 'WhatsApp', icon: 'whatsapp', path: '/whatsapp', perm: 'whatsapp.send' },
  ],
};
