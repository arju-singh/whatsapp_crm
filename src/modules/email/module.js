// Feature module: Email channel. SMTP send + templates + open tracking (routes at
// /api/email). A messaging transport, peer to WhatsApp, behind sendMessage().
module.exports = {
  key: 'email',
  name: 'Email',
  description: 'Send templated email and track opens over SMTP.',
  core: false,
  dependsOn: ['messaging'],
  permissions: ['email.read', 'email.send'],
  nav: [],
};
