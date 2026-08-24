import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { DEVICE_TYPES, RELEASE_TYPE_LABELS } from '../config';
import { logger } from '../utils/logger';
import { audit }  from '../utils/audit';

function compareSemver(a, b) {
  const pa = a.split('.').map(n => parseInt(n) || 0);
  const pb = b.split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function sortPackages(pkgs, col, dir) {
  if (!col) return pkgs;
  return [...pkgs].sort((a, b) => {
    let av = a[col], bv = b[col];
    if (col === 'version') return dir * compareSemver(av || '', bv || '');
    if (col === 'createdAt' || col === 'artifactSize') return dir * ((av || 0) - (bv || 0));
    if (col === 'activated') return dir * ((av ? 1 : 0) - (bv ? 1 : 0));
    return dir * (av || '').toString().localeCompare((bv || '').toString());
  });
}

function filterPackages(pkgs, searches) {
  return pkgs.filter(p => {
    for (const [col, val] of Object.entries(searches)) {
      if (!val || val.length < 3) continue;
      const v = val.toLowerCase();
      if (col === 'packageName'  && !(p.packageName  || '').toLowerCase().includes(v)) return false;
      if (col === 'version'      && !(p.version      || '').toLowerCase().includes(v)) return false;
      if (col === 'releaseNotes' && !(p.releaseNotes || '').toLowerCase().includes(v)) return false;
      if (col === 'artifactSize') {
        const mb = p.artifactSize ? (p.artifactSize / 1024 / 1024).toFixed(1) : '0.0';
        if (!mb.includes(v)) return false;
      }
      if (col === 'createdAt') {
        const d = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '';
        if (!d.toLowerCase().includes(v)) return false;
      }
      if (col === 'activated') {
        if (!(p.activated ? 'yes' : 'no').includes(v)) return false;
      }
    }
    return true;
  });
}

export default function PackagesPage() {
  const { token, logout } = useAuth();
  const [packages,    setPackages]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [typeFilter,   setTypeFilter]   = useState('');
  const [actionMsg,    setActionMsg]    = useState('');
  const [sortCol,        setSortCol]        = useState('');
  const [sortDir,        setSortDir]        = useState(1);
  const [activeSearchCol, setActiveSearchCol] = useState(null);
  const [columnSearches,  setColumnSearches]  = useState({});

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => -d);
    else { setSortCol(col); setSortDir(1); }
  };

  const setSearch = (col, val) =>
    setColumnSearches(prev => ({ ...prev, [col]: val }));

  const clearSearch = (col) =>
    setColumnSearches(prev => { const n = { ...prev }; delete n[col]; return n; });

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span className="sort-icon sort-idle">↕</span>;
    return <span className="sort-icon sort-active">{sortDir === 1 ? '↑' : '↓'}</span>;
  };

  // Renders a th that is both sortable (via icon) and searchable (via label click)
  const SearchSortTh = (col, label) => {
    const val = columnSearches[col] || '';
    const hasFilter = val.length >= 3;

    if (activeSearchCol === col) {
      return (
        <th key={col} className="th-searching">
          <input
            autoFocus
            className="th-search-input"
            value={val}
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
          <span className="search-chip" onClick={e => { e.stopPropagation(); clearSearch(col); }}>
            {val}&nbsp;✕
          </span>
        )}
        <span className="sort-icon-btn" onClick={e => { e.stopPropagation(); toggleSort(col); }}>
          <SortIcon col={col} />
        </span>
      </th>
    );
  };

  const load = async () => {
    setLoading(true);
    setError('');
    logger.debug('PackagesPage', 'Loading packages', { statusFilter, typeFilter });
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('deviceType', typeFilter);
      const { data } = await apiClient(token, logout).get(`/ota/packages?${params}`);
      const pkgs = data.packages || [];
      setPackages(pkgs);
      logger.info('PackagesPage', 'Packages loaded', { count: pkgs.length, statusFilter, typeFilter });
    } catch (err) {
      const reason = err?.response?.data?.error || err?.response?.data?.message || 'Failed to load packages';
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
    const confirmMsg = pkg.activated
      ? `Withdraw ${pkg.packageName} v${pkg.version}? Devices will no longer receive this update.`
      : `Publish ${pkg.packageName} v${pkg.version}? Devices will start receiving this update.`;
    if (!confirm(confirmMsg)) return;
    const newVal  = !pkg.activated;
    const resource = { packageName: pkg.packageName, version: pkg.version };

    logger.info('PackagesPage', `${action} initiated`, resource);
    audit.log(action, resource, 'INITIATED');

    try {
      await apiClient(token, logout).patch(
        `/ota/packages/${pkg.packageName}/${pkg.version}/activate`,
        { activated: newVal },
      );
      logger.info('PackagesPage', `${action} successful`, resource);
      audit.log(action, resource, 'SUCCESS');
      setActionMsg(`${pkg.packageName} v${pkg.version} ${newVal ? 'published' : 'withdrawn'}`);
      setTimeout(() => setActionMsg(''), 3000);
      load();
    } catch (err) {
      const reason = err?.response?.data?.error || err?.response?.data?.message || 'Action failed';
      logger.error('PackagesPage', `${action} failed`, { ...resource, reason });
      audit.log(action, resource, 'FAILURE', { reason });
      setError(reason);
    }
  };

  const promotePackage = async (pkg) => {
    if (!confirm(
      `Promote ${pkg.packageName} v${pkg.version} from Beta (UAT) → PROD?\n\n` +
      `This is permanent — PROD cannot be downgraded. ` +
      `Lower PROD versions of this package will be superseded.`
    )) return;
    const resource = { packageName: pkg.packageName, version: pkg.version };
    logger.info('PackagesPage', 'PACKAGE_PROMOTE initiated', resource);
    audit.log('PACKAGE_PROMOTE', resource, 'INITIATED');
    try {
      await apiClient(token, logout).patch(
        `/ota/packages/${pkg.packageName}/${pkg.version}/activate`,
        { promote: true },
      );
      logger.info('PackagesPage', 'PACKAGE_PROMOTE successful', resource);
      audit.log('PACKAGE_PROMOTE', resource, 'SUCCESS');
      setActionMsg(`${pkg.packageName} v${pkg.version} promoted to PROD.`);
      setTimeout(() => setActionMsg(''), 4000);
      load();
    } catch (err) {
      const reason = err?.response?.data?.error || err?.response?.data?.message || 'Promote failed';
      logger.error('PackagesPage', 'PACKAGE_PROMOTE failed', { ...resource, reason });
      audit.log('PACKAGE_PROMOTE', resource, 'FAILURE', { reason });
      setError(reason);
    }
  };

  const restorePackage = async (pkg) => {
    if (!confirm(
      `Restore ${pkg.packageName} v${pkg.version} to ACTIVE?\n\n` +
      `Any currently ACTIVE ${pkg.releaseType} version of this package will be superseded. ` +
      `Use this to roll back a buggy release.`
    )) return;
    const resource = { packageName: pkg.packageName, version: pkg.version };
    logger.info('PackagesPage', 'PACKAGE_RESTORE initiated', resource);
    audit.log('PACKAGE_RESTORE', resource, 'INITIATED');
    try {
      await apiClient(token, logout).patch(
        `/ota/packages/${pkg.packageName}/${pkg.version}/activate`,
        { restore: true },
      );
      logger.info('PackagesPage', 'PACKAGE_RESTORE successful', resource);
      audit.log('PACKAGE_RESTORE', resource, 'SUCCESS');
      setActionMsg(`${pkg.packageName} v${pkg.version} restored to ACTIVE.`);
      setTimeout(() => setActionMsg(''), 4000);
      load();
    } catch (err) {
      const reason = err?.response?.data?.error || err?.response?.data?.message || 'Restore failed';
      logger.error('PackagesPage', 'PACKAGE_RESTORE failed', { ...resource, reason });
      audit.log('PACKAGE_RESTORE', resource, 'FAILURE', { reason });
      setError(reason);
    }
  };

  const recallPackage = async (pkg) => {
    const reason = prompt(
      `Recall ${pkg.packageName} v${pkg.version}?\n\n` +
      `This will immediately remove it from all device update checks and flag it in audit logs.\n\n` +
      `Enter recall reason (required):`,
    );
    if (reason === null) return; // cancelled
    if (!reason.trim()) { alert('Recall reason is required.'); return; }

    const resource = { packageName: pkg.packageName, version: pkg.version };
    logger.info('PackagesPage', 'PACKAGE_RECALL initiated', { ...resource, reason });
    audit.log('PACKAGE_RECALL', resource, 'INITIATED', { reason });

    try {
      await apiClient(token, logout).patch(
        `/ota/packages/${pkg.packageName}/${pkg.version}/activate`,
        { recalled: true, recallReason: reason.trim() },
      );
      logger.info('PackagesPage', 'PACKAGE_RECALL successful', resource);
      audit.log('PACKAGE_RECALL', resource, 'SUCCESS', { reason });
      setActionMsg(`${pkg.packageName} v${pkg.version} recalled — removed from all device update checks.`);
      setTimeout(() => setActionMsg(''), 5000);
      load();
    } catch (err) {
      const errReason = err?.response?.data?.error || err?.response?.data?.message || 'Recall failed';
      logger.error('PackagesPage', 'PACKAGE_RECALL failed', { ...resource, reason: errReason });
      audit.log('PACKAGE_RECALL', resource, 'FAILURE', { reason: errReason });
      setError(errReason);
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
          <option value="">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUPERSEDED">SUPERSEDED</option>
          <option value="PENDING">PENDING</option>
          <option value="CORRUPTED">CORRUPTED</option>
          <option value="RECALLED">RECALLED</option>
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
                {SearchSortTh('packageName',  'Package')}
                {SearchSortTh('version',      'Version')}
                <th>Device Type</th>
                <th>Release</th>
                <th>Status</th>
                {SearchSortTh('artifactSize', 'Size')}
                {SearchSortTh('releaseNotes', 'Release Notes')}
                {SearchSortTh('createdAt',    'Created')}
                {SearchSortTh('activated',    'Published')}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filterPackages(sortPackages(packages, sortCol, sortDir), columnSearches).map(p => (
                <tr key={`${p.packageName}-${p.version}`}>
                  <td><strong>{p.packageName}</strong></td>
                  <td><code>{p.version}</code></td>
                  <td className="text-sm text-muted">{p.deviceType}</td>
                  <td><span className="badge badge-grey">{RELEASE_TYPE_LABELS[p.releaseType] || p.releaseType}</span></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>{p.artifactSize ? `${(p.artifactSize / 1024 / 1024).toFixed(1)} MB` : '—'}</td>
                  <td className="text-sm text-muted">{p.releaseNotes || '—'}</td>
                  <td className="text-sm">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <span className={`badge ${p.activated ? 'badge-green' : 'badge-grey'}`}>
                      {p.activated ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <div className="action-cell">
                      {p.status === 'ACTIVE' && (
                        <>
                          <button
                            className={`btn btn-sm ${p.activated ? 'btn-secondary' : 'btn-primary'}`}
                            onClick={() => toggleActivate(p)}
                          >
                            {p.activated ? 'Withdraw' : 'Publish'}
                          </button>
                          {p.releaseType === 'BETA' && (
                            <button
                              className="btn btn-sm btn-promote"
                              onClick={() => promotePackage(p)}
                              title="Promote Beta (UAT) → PROD (permanent)"
                            >
                              → PROD
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-recall"
                            onClick={() => recallPackage(p)}
                          >
                            Recall
                          </button>
                        </>
                      )}
                      {p.status === 'SUPERSEDED' && p.releaseType !== 'CUSTOM' && (
                        <button
                          className="btn btn-sm btn-restore"
                          onClick={() => restorePackage(p)}
                          title="Restore this version to ACTIVE (rollback)"
                        >
                          ↩ Restore
                        </button>
                      )}
                      {p.status === 'RECALLED' && (
                        <span className="text-sm text-muted">Recalled</span>
                      )}
                    </div>
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
