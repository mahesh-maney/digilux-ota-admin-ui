import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

function sortUsers(users, col, dir) {
  if (!col) return users;
  return [...users].sort((a, b) =>
    dir * (a[col] || '').toString().localeCompare((b[col] || '').toString())
  );
}

function filterUsers(users, searches) {
  return users.filter(u => {
    for (const [col, val] of Object.entries(searches)) {
      if (!val || val.length < 3) continue;
      const v = val.toLowerCase();
      if (col === 'email'     && !(u.email     || '').toLowerCase().includes(v)) return false;
      if (col === 'deviceId'  && !(u.deviceId  || '').toLowerCase().includes(v)) return false;
      if (col === 'thingName' && !(u.thingName || '').toLowerCase().includes(v)) return false;
      if (col === 'addedAt') {
        const d = u.addedAt ? new Date(u.addedAt).toLocaleDateString() : '';
        if (!d.toLowerCase().includes(v)) return false;
      }
      if (col === 'addedBy' && !(u.addedBy || '').toLowerCase().includes(v)) return false;
    }
    return true;
  });
}

export default function BetaUsersPanel({ token, logout }) {
  const [users,           setUsers]           = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [email,           setEmail]           = useState('');
  const [adding,          setAdding]          = useState(false);
  const [error,           setError]           = useState('');
  const [success,         setSuccess]         = useState('');
  const [sortCol,         setSortCol]         = useState('');
  const [sortDir,         setSortDir]         = useState(1);
  const [activeSearchCol, setActiveSearchCol] = useState(null);
  const [columnSearches,  setColumnSearches]  = useState({});

  const toggleSort  = (col) => { if (sortCol === col) setSortDir(d => -d); else { setSortCol(col); setSortDir(1); } };
  const setSearch   = (col, val) => setColumnSearches(prev => ({ ...prev, [col]: val }));
  const clearSearch = (col)      => setColumnSearches(prev => { const n = { ...prev }; delete n[col]; return n; });

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span className="sort-icon sort-idle">↕</span>;
    return <span className="sort-icon sort-active">{sortDir === 1 ? '↑' : '↓'}</span>;
  };

  const SearchSortTh = (col, label) => {
    const val = columnSearches[col] || '';
    const hasFilter = val.length >= 3;
    if (activeSearchCol === col) {
      return (
        <th key={col} className="th-searching">
          <input autoFocus className="th-search-input" value={val}
            onChange={e => setSearch(col, e.target.value)}
            onBlur={() => setActiveSearchCol(null)}
            onKeyDown={e => {
              if (e.key === 'Escape') { clearSearch(col); setActiveSearchCol(null); }
              if (e.key === 'Enter')  { setActiveSearchCol(null); }
            }}
            placeholder={`Search ${label}…`}
          />
        </th>
      );
    }
    return (
      <th key={col} className="th-sort">
        <span className="th-label" onClick={() => setActiveSearchCol(col)}>{label}</span>
        {hasFilter && (
          <span className="search-chip" onClick={e => { e.stopPropagation(); clearSearch(col); }}>{val}&nbsp;✕</span>
        )}
        <span className="sort-icon-btn" onClick={e => { e.stopPropagation(); toggleSort(col); }}>
          <SortIcon col={col} />
        </span>
      </th>
    );
  };

  const client = apiClient(token, logout);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/ota/beta-users');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load beta users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await client.post('/ota/beta-users', { email: email.trim().toLowerCase() });
      setSuccess(`Added ${data.email} (device: ${data.deviceId})`);
      setEmail('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add beta user');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userEmail) => {
    if (!window.confirm(`Remove ${userEmail} from beta users?`)) return;
    setError('');
    setSuccess('');
    try {
      await client.delete(`/ota/beta-users/${encodeURIComponent(userEmail)}`);
      setSuccess(`${userEmail} removed`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove beta user');
    }
  };

  return (
    <div className="card mb-4">
      <h3>Beta Users</h3>

      <form onSubmit={handleAdd} className="form-grid" style={{ alignItems: 'flex-end' }}>
        <div className="field">
          <label>Add by Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="user@example.com"
            disabled={adding}
            required
          />
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !email.trim()}>
            {adding ? 'Resolving…' : '+ Add'}
          </button>
        </div>
      </form>

      {error   && <div className="alert alert-error mt-4">{error}</div>}
      {success && <div className="alert alert-success mt-4">{success}</div>}

      <div className="mt-4">
        {loading ? (
          <div className="text-muted">Loading…</div>
        ) : users.length === 0 ? (
          <div className="empty">No beta users yet. Add one above.</div>
        ) : (
          <table>
            <thead>
              <tr>
                {SearchSortTh('email',     'Email')}
                {SearchSortTh('deviceId',  'Device ID')}
                {SearchSortTh('thingName', 'Thing Name')}
                {SearchSortTh('addedAt',   'Added')}
                {SearchSortTh('addedBy',   'Added By')}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filterUsers(sortUsers(users, sortCol, sortDir), columnSearches).map(u => (
                <tr key={u.email}>
                  <td>{u.email}</td>
                  <td><code className="text-sm" title={u.deviceId}>{u.deviceId?.slice(0, 8)}…</code></td>
                  <td><code className="text-sm">{u.thingName}</code></td>
                  <td className="text-sm">{u.addedAt ? new Date(u.addedAt).toLocaleDateString() : '—'}</td>
                  <td className="text-sm">{u.addedBy}</td>
                  <td>
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--red)' }}
                      onClick={() => handleRemove(u.email)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
