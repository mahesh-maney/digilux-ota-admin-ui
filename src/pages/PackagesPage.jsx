import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { DEVICE_TYPES } from '../config';
import { logger } from '../utils/logger';
import { audit }  from '../utils/audit';

export default function PackagesPage() {
  const { token } = useAuth();
  const [packages,    setPackages]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [typeFilter,   setTypeFilter]   = useState('');
  const [actionMsg,    setActionMsg]    = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    logger.debug('PackagesPage', 'Loading packages', { statusFilter, typeFilter });
    try {
      const params = new URLSearchParams({ status: statusFilter });
      if (typeFilter) params.set('deviceType', typeFilter);
      const { data } = await apiClient(token).get(`/ota/packages?${params}`);
      const pkgs = data.packages || [];
      setPackages(pkgs);
      logger.info('PackagesPage', 'Packages loaded', { count: pkgs.length, statusFilter, typeFilter });
    } catch (err) {
      const reason = err.response?.data?.error || 'Failed to load packages';
      logger.error('PackagesPage', 'Failed to load packages', { statusFilter, typeFilter, reason });
      setError(reason);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    logger.debug('PackagesPage', 'Filter changed', { statusFilter, typeFilter });
    load();
  }, [statusFilter, typeFilter]);

  const toggleActivate = async (pkg) => {
    const action = pkg.activated ? 'PACKAGE_WITHDRAW' : 'PACKAGE_PUBLISH';
    const newVal  = !pkg.activated;
    const resource = { packageName: pkg.packageName, version: pkg.version };

    logger.info('PackagesPage', `${action} initiated`, resource);
    audit.log(action, resource, 'INITIATED');

    try {
      await apiClient(token).patch(
        `/ota/packages/${pkg.packageName}/${pkg.version}/activate`,
        { activated: newVal },
      );
      logger.info('PackagesPage', `${action} successful`, resource);
      audit.log(action, resource, 'SUCCESS');
      setActionMsg(`${pkg.packageName} v${pkg.version} ${newVal ? 'published' : 'withdrawn'}`);
      setTimeout(() => setActionMsg(''), 3000);
      load();
    } catch (err) {
      const reason = err.response?.data?.error || 'Action failed';
      logger.error('PackagesPage', `${action} failed`, { ...resource, reason });
      audit.log(action, resource, 'FAILURE', { reason });
      setError(reason);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Packages</h2>
        <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
      </div>

      <div className="filters">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="ACTIVE">ACTIVE</option>
          <option value="PENDING">PENDING</option>
          <option value="CORRUPTED">CORRUPTED</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All device types</option>
          {DEVICE_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {actionMsg && <div className="alert alert-success">{actionMsg}</div>}
      {error     && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : packages.length === 0 ? (
        <div className="empty">No packages found.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Version</th>
                <th>Device Type</th>
                <th>Release</th>
                <th>Status</th>
                <th>Size</th>
                <th>Created</th>
                <th>Published</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {packages.map(p => (
                <tr key={`${p.packageName}-${p.version}`}>
                  <td><strong>{p.packageName}</strong></td>
                  <td><code>{p.version}</code></td>
                  <td className="text-sm text-muted">{p.deviceType}</td>
                  <td><span className="badge badge-grey">{p.releaseType}</span></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>{p.artifactSize ? `${(p.artifactSize / 1024 / 1024).toFixed(1)} MB` : '—'}</td>
                  <td className="text-sm">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <span className={`badge ${p.activated ? 'badge-green' : 'badge-grey'}`}>
                      {p.activated ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>
                    {p.status === 'ACTIVE' && (
                      <button
                        className={`btn btn-sm ${p.activated ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => toggleActivate(p)}
                      >
                        {p.activated ? 'Withdraw' : 'Publish'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
