import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

export default function BetaUsersPanel({ token, logout }) {
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [email,    setEmail]    = useState('');
  const [adding,   setAdding]   = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

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
                <th>Email</th>
                <th>Device ID</th>
                <th>Thing Name</th>
                <th>Added</th>
                <th>Added By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
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
