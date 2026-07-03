// =============================================================
// User management — list, create, edit, delete, change password.
// =============================================================

const Users = () => {
  const me = window.CURRENT_USER;
  const [rows, setRows] = React.useState(null);
  const [err, setErr] = React.useState('');
  const [editing, setEditing] = React.useState(null); // user being edited (or 'new')
  const [showPwd, setShowPwd] = React.useState(false); // change-password modal

  const load = React.useCallback(async () => {
    try {
      const r = await api('/api/users');
      setRows(r.rows || []);
    } catch (e) { setErr(e.message); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  if (!me) return null;
  const isSuper = me.role === 'super_admin';
  const isAdmin = me.role === 'admin' || isSuper;
  if (!isAdmin) {
    return (
      <div className="page slide-up">
        <h1 className="page-title">Users</h1>
        <div className="card" style={{ padding: 24 }}>
          You need <strong>admin</strong> or <strong>super_admin</strong> to view this page.
        </div>
      </div>
    );
  }

  const roleColor = (r) => r === 'super_admin' ? '#E07A5F' : r === 'admin' ? '#3D5A80' : '#7A7670';

  const approveAs = async (user, role) => {
    try {
      await api('/api/users/' + user.id, { method: 'PUT', body: { role, active: true } });
      load();
    } catch (e) { alert(e.message); }
  };
  const reject = async (user) => {
    if (!confirm(`Reject the signup request from ${user.name} (+${user.phone})? This deletes their pending account.`)) return;
    try {
      await api('/api/users/' + user.id, { method: 'DELETE' });
      load();
    } catch (e) { alert(e.message); }
  };
  const resetPassword = async (user) => {
    const next = prompt(`Set a new password for ${user.name} (+${user.phone}). Minimum 6 characters.\n\nThey will be signed out of any active sessions.`);
    if (next == null) return;
    if (next.length < 6) { alert('Password must be at least 6 characters.'); return; }
    try {
      await api('/api/users/' + user.id, { method: 'PUT', body: { password: next } });
      alert(`Password set. New password: ${next}\nShare it with them and ask them to change it on first login.`);
      load();
    } catch (e) { alert(e.message); }
  };

  const pending = (rows || []).filter((u) => !u.active);
  const active = (rows || []).filter((u) => u.active);

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{rows ? rows.length : '—'} accounts{pending.length > 0 ? ` · ${pending.length} pending` : ''}</div>
          <h1 className="page-title">Team <em>access</em></h1>
          <div className="page-sub">Who can sign in. Phone is the username. Only super_admins can add, approve, or remove people.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setShowPwd(true)}>Change my password</button>
          {isSuper && (
            <button className="btn primary" onClick={() => setEditing({ _new: true, role: 'user' })}>
              <Icon name="plus" size={12} />Add user
            </button>
          )}
        </div>
      </div>

      {err && <div className="card" style={{ padding: 12, marginBottom: 12, color: '#B73225', fontSize: 12 }}>{err}</div>}

      {isSuper && pending.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16, border: '1px solid #D4A373' }}>
          <div style={{ padding: '10px 16px', background: '#F4DCD2', borderBottom: '1px solid #D4A373', fontSize: 12, fontWeight: 600, color: '#5C3A28', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#D4A373' }}></span>
            {pending.length} pending sign-up{pending.length === 1 ? '' : 's'} — review &amp; approve below
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Requested</th>
                <th style={{ width: 360 }}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td className="mono" style={{ fontSize: 12 }}>+{u.phone}</td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{u.created_at ? humanAge(u.created_at) + ' ago' : '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn sm primary" onClick={() => approveAs(u, 'admin')}>Approve as Admin</button>
                      <button className="btn sm" onClick={() => approveAs(u, 'user')}>Approve as User</button>
                      <button className="btn sm" style={{ color: '#B73225' }} onClick={() => reject(u)}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 48, textAlign: 'right' }}>#</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Active</th>
              <th>Last login</th>
              <th>Created</th>
              <th>Password</th>
              <th style={{ width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {active.map((u, i) => (
              <tr key={u.id}>
                <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11 }} className="mono">{i + 1}</td>
                <td><strong>{u.name}</strong>{me.id === u.id && <span style={{ color: 'var(--muted)', fontSize: 11 }}> · you</span>}</td>
                <td className="mono" style={{ fontSize: 12 }}>+{u.phone}</td>
                <td>
                  <span style={{
                    fontSize: 11, padding: '3px 8px', borderRadius: 4,
                    background: roleColor(u.role) + '22', color: roleColor(u.role),
                    fontWeight: 600, textTransform: 'capitalize',
                  }}>{u.role.replace('_', ' ')}</span>
                </td>
                <td>{u.active ? <span style={{ color: '#588157' }}>● Yes</span> : <span style={{ color: 'var(--muted)' }}>○ No</span>}</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{u.last_login_at ? humanAge(u.last_login_at) + ' ago' : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{u.created_at ? humanAge(u.created_at) + ' ago' : '—'}</td>
                <td>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>•••••••</span>
                  {isSuper && (
                    <button
                      className="btn sm"
                      style={{ marginLeft: 6, fontSize: 11 }}
                      title="Set a new password for this user"
                      onClick={() => resetPassword(u)}
                    >Reset</button>
                  )}
                </td>
                <td>
                  {isSuper && (
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn sm" onClick={() => setEditing(u)}>Edit</button>
                      {me.id !== u.id && (
                        <button
                          className="btn sm"
                          style={{ color: '#B73225' }}
                          onClick={async () => {
                            if (!confirm(`Delete ${u.name} (+${u.phone})? This sign-out their sessions immediately.`)) return;
                            try { await api('/api/users/' + u.id, { method: 'DELETE' }); load(); }
                            catch (e) { alert(e.message); }
                          }}
                        >Delete</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows && active.length === 0 && (
              <tr><td colSpan="9" style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No active users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <UserModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  );
};

const renderModal = (content) => ReactDOM.createPortal(content, document.body);

const UserModal = ({ user, onClose, onSaved }) => {
  const isNew = !!user._new;
  const [form, setForm] = React.useState({
    name: user.name || '',
    phone: user.phone || '',
    password: '',
    role: user.role || 'user',
    active: user.active !== undefined ? !!user.active : true,
  });
  const [err, setErr] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setErr(''); setSaving(true);
    try {
      if (isNew) {
        if (!form.name || !form.phone || !form.password) throw new Error('Name, phone, and password are required.');
        await api('/api/users', { method: 'POST', body: form });
      } else {
        const body = { name: form.name, role: form.role, active: form.active };
        if (form.password) body.password = form.password;
        await api('/api/users/' + user.id, { method: 'PUT', body });
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return renderModal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9999,
        background: 'rgba(20,18,15,0.5)', backdropFilter: 'blur(2px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 12,
          padding: 28,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <h3 className="serif" style={{ fontSize: 22, margin: '0 0 18px', letterSpacing: '-0.02em' }}>
          {isNew ? 'Add user' : `Edit ${user.name}`}
        </h3>

        <AccountField label="Name">
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" />
        </AccountField>
        <AccountField label="Phone (with country code)">
          <input
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            disabled={!isNew}
            placeholder="9306466642"
            className="mono"
          />
          {!isNew && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Phone can't be changed after creation.</div>}
        </AccountField>
        <AccountField label={isNew ? 'Password' : 'New password (leave blank to keep current)'}>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder={isNew ? 'At least 6 characters' : '••••••'}
          />
        </AccountField>
        <AccountField label="Role">
          <select value={form.role} onChange={(e) => set('role', e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
            <option value="super_admin">super_admin</option>
          </select>
        </AccountField>
        {!isNew && (
          <AccountField label="Active">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Can sign in
            </label>
          </AccountField>
        )}

        {err && <div style={{ color: '#B73225', fontSize: 12, marginTop: 8 }}>{err}</div>}

        <div className="row" style={{ gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : (isNew ? 'Create user' : 'Save')}</button>
        </div>
      </div>
      </div>
    </div>
  );
};

const ChangePasswordModal = ({ onClose }) => {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm2, setConfirm2] = React.useState('');
  const [err, setErr] = React.useState('');
  const [ok, setOk] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setErr('');
    if (next !== confirm2) { setErr("New passwords don't match."); return; }
    if (next.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    setSaving(true);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { current, next } });
      setOk(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setErr(e.message === 'wrong_current_password' ? 'Current password is wrong.' : e.message);
      setSaving(false);
    }
  };

  return renderModal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9999,
        background: 'rgba(20,18,15,0.5)', backdropFilter: 'blur(2px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(400px, 100%)',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 12,
          padding: 28,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <h3 className="serif" style={{ fontSize: 22, margin: '0 0 18px', letterSpacing: '-0.02em' }}>Change password</h3>
        {ok ? (
          <div style={{ color: '#588157', fontSize: 13 }}>✓ Password changed. Other sessions have been signed out.</div>
        ) : (
          <>
            <AccountField label="Current password"><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></AccountField>
            <AccountField label="New password"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></AccountField>
            <AccountField label="Confirm new password"><input type="password" value={confirm2} onChange={(e) => setConfirm2(e.target.value)} /></AccountField>
            {err && <div style={{ color: '#B73225', fontSize: 12, marginTop: 8 }}>{err}</div>}
            <div className="row" style={{ gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Change password'}</button>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
};

const AccountField = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ fontSize: 11, color: 'var(--ink-2)', marginBottom: 4, fontWeight: 500 }}>{label}</div>
    {children}
  </div>
);
