// User management page (admins only), served as a plain static page next to
// the React app. Sign-in lives in the app itself at "/", so anything that
// needs a session bounces there.
(function () {
  function el(tag, opts = {}) {
    const node = document.createElement(tag);
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.className) node.className = opts.className;
    return node;
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.href = '/';
      throw new Error('Not signed in');
    }
    return { res, body: await res.json().catch(() => ({})) };
  }

  let currentUsername = null;

  async function loadUsers() {
    const { res, body } = await fetchJson('/auth/admin/users');
    if (!res.ok) return;
    const tbody = document.getElementById('usersBody');
    tbody.innerHTML = '';
    for (const u of body.users) {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', { text: u.username }));
      tr.appendChild(el('td', { text: u.display_name }));
      // "Admin" / "User", and the date written the way the report pages
      // write dates — in Adelaide time, like everything else here.
      tr.appendChild(el('td', { text: u.role === 'admin' ? 'Admin' : 'User' }));
      tr.appendChild(
        el('td', {
          text: new Date(u.created_at).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: 'Australia/Adelaide',
          }),
        }),
      );

      const actionsTd = document.createElement('td');
      const resetBtn = el('button', { text: 'Reset password', className: 'btn btn-secondary' });
      resetBtn.addEventListener('click', async () => {
        const newPassword = prompt(`New password for ${u.username} (min 8 chars):`);
        if (!newPassword) return;
        const { res: rres, body: rbody } = await fetchJson(`/auth/admin/users/${encodeURIComponent(u.username)}/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword }),
        });
        if (!rres.ok) alert(rbody.error || 'Reset failed.');
        else alert('Password reset.');
      });
      actionsTd.appendChild(resetBtn);

      if (u.username !== currentUsername) {
        const deleteBtn = el('button', { text: 'Delete', className: 'btn btn-secondary' });
        deleteBtn.style.marginLeft = '6px';
        deleteBtn.addEventListener('click', async () => {
          if (!confirm(`Delete user ${u.username}?`)) return;
          const { res: dres, body: dbody } = await fetchJson(`/auth/admin/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' });
          if (!dres.ok) alert(dbody.error || 'Delete failed.');
          else loadUsers();
        });
        actionsTd.appendChild(deleteBtn);
      }

      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    }
  }

  document.getElementById('createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('createError');
    errorEl.textContent = '';
    const payload = {
      username: document.getElementById('newUsername').value.trim(),
      displayName: document.getElementById('newDisplayName').value.trim(),
      password: document.getElementById('newPassword').value,
      role: document.getElementById('newRole').value,
    };
    const { res, body } = await fetchJson('/auth/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      errorEl.textContent = body.error || 'Create failed.';
      return;
    }
    document.getElementById('createForm').reset();
    loadUsers();
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });

  (async function init() {
    const { res, body } = await fetchJson('/auth/me');
    if (!res.ok || body.role !== 'admin') {
      document.getElementById('notAuthorized').style.display = '';
      return;
    }
    currentUsername = body.username;
    document.getElementById('adminContent').style.display = '';
    loadUsers();
  })();
})();
