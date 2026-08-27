import { useEffect, useState, useRef } from 'react';
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
    if (col === 'fileName') return dir * (av || '').localeCompare(bv || '');
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
      if (col === 'fileName'     && !(p.fileName     || p.packageName || '').toLowerCase().includes(v)) return false;
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
      if (col === 'status' && !(p.status || '').toLowerCase().includes(v)) return false;
      if (col === 'deviceType' && !(p.deviceType || '').toLowerCase().includes(v)) return false;
    }
    return true;
  });
}

export default function PackagesPage() {
  const { token, logout, isAdmin } = useAuth();
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
      const pkgs = (data.packages || []).filter(p => {
        if (p.status === 'DELETED') return false;
        if (statusFilter && p.status !== statusFilter) return false;
        return true;
      });
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

  const [deleteModal, setDeleteModal]           = useState(null); // pkg or null
  const [deleteReason, setDeleteReason]         = useState('');
  const [deleteConfirm, setDeleteConfirm]       = useState('');
  const [deleteForce, setDeleteForce]           = useState(false);
  const [deleteWorking, setDeleteWorking]       = useState(false);
  const [deleteModalError, setDeleteModalError] = useState('');
  const [coolingOff, setCoolingOff]             = useState(null); // {supersededDaysAgo, coolingOffDays}
  const reasonRef = useRef(null);

  const openDeleteModal = (pkg) => {
    setDeleteModal(pkg);
    setDeleteReason('');
    setDeleteConfirm('');
    setDeleteForce(false);
    setDeleteWorking(false);
    setDeleteModalError('');
    setCoolingOff(null);
    setTimeout(() => reasonRef.current?.focus(), 50);
  };

  const closeDeleteModal = () => {
    setDeleteModal(null);
    setDeleteModalError('');
    setCoolingOff(null);
  };

  const submitDelete = async (force = false) => {
    const pkg = deleteModal;
    if (!pkg) return;
    setDeleteWorking(true);
    setDeleteModalError('');
    const resource = { packageName: pkg.packageName, version: pkg.version };
    logger.info('PackagesPage', 'PACKAGE_DELETE initiated', resource);
    audit.log('PACKAGE_DELETE', resource, 'INITIATED');
    try {
      const resp = await apiClient(token, logout).delete(
        `/ota/packages/${pkg.packageName}/${pkg.version}`,
        { data: { reason: deleteReason.trim(), force } },
      );
      const msg = resp.data?.message || `${pkg.packageName} v${pkg.version} deleted.`;
      logger.info('PackagesPage', 'PACKAGE_DELETE successful', resource);
      audit.log('PACKAGE_DELETE', resource, 'SUCCESS');
      setActionMsg(msg);
      setTimeout(() => setActionMsg(''), 5000);
      closeDeleteModal();
      load();
    } catch (err) {
      const data   = err?.response?.data || {};
      const reason = data.error || 'Delete failed';
      if (data.coolingOff) {
        setCoolingOff({ supersededDaysAgo: data.supersededDaysAgo, coolingOffDays: data.coolingOffDays });
        setDeleteModalError(reason);
      } else {
        setDeleteModalError(reason);
        logger.error('PackagesPage', 'PACKAGE_DELETE failed', { ...resource, reason });
        audit.log('PACKAGE_DELETE', resource, 'FAILURE', { reason });
      }
    } finally {
      setDeleteWorking(false);
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
                {SearchSortTh('fileName',     'File')}
                {SearchSortTh('deviceType',   'Device Type')}
                <th>Release</th>
                {SearchSortTh('status',       'Status')}
                <th>Action</th>
                {SearchSortTh('artifactSize', 'Size')}
                {SearchSortTh('releaseNotes', 'Release Notes')}
                {SearchSortTh('createdAt',    'Created')}
                {SearchSortTh('activated',    'Published')}
              </tr>
            </thead>
            <tbody>
              {filterPackages(sortPackages(packages, sortCol, sortDir), columnSearches).map(p => (
                <tr key={`${p.packageName}-${p.version}`} className={
                    p.status === 'RECALLED'                                          ? 'row-recalled'
                  : p.status === 'ACTIVE' && (p.releaseType === 'BETA' || p.releaseType === 'UAT') && p.activated ? 'row-uat'
                  : p.status === 'ACTIVE' && p.activated                             ? 'row-published'
                  : p.status === 'ACTIVE' && !p.activated                            ? 'row-unpublished'
                  : ''
                }>
                  <td><strong>{p.fileName || p.packageName}</strong></td>
                  <td className="text-sm text-muted">{p.deviceType}</td>
                  <td><span className="badge badge-grey">{RELEASE_TYPE_LABELS[p.releaseType] || p.releaseType}</span></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <div className="action-cell">
                      {isAdmin && p.status === 'ACTIVE' && (
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
                      {isAdmin && p.status === 'SUPERSEDED' && p.releaseType !== 'CUSTOM' && (
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
                      {isAdmin && p.status !== 'ACTIVE' && p.status !== 'DELETED' && (
                        <button
                          className="btn btn-sm btn-delete"
                          onClick={() => openDeleteModal(p)}
                          title="Permanently delete this package and its S3 artifact"
                        >
                          🗑 Delete
                        </button>
                      )}
                    </div>
                  </td>
                  <td>{p.artifactSize ? `${(p.artifactSize / 1024 / 1024).toFixed(1)} MB` : '—'}</td>
                  <td className="text-sm text-muted">{p.releaseNotes || '—'}</td>
                  <td className="text-sm">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <span className={`badge ${p.activated ? 'badge-green' : 'badge-grey'}`}>
                      {p.activated ? 'Yes' : 'No'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Delete Modal ───────────────────────────────────────────────── */}
      {deleteModal && (
        <div className="modal-backdrop" onClick={closeDeleteModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Delete Package</h3>

            <div className="modal-body">
              <p>
                You are about to delete <strong>{deleteModal.fileName || deleteModal.packageName}</strong> v<strong>{deleteModal.version}</strong>.
              </p>

              {deleteModal.status === 'RECALLED' ? (
                <div className="alert alert-warn" style={{marginBottom:12}}>
                  ⚠ This package was <strong>recalled</strong>. The S3 artifact will be deleted but the audit record will be <strong>retained</strong> for forensic purposes.
                </div>
              ) : (
                <div className="alert alert-error" style={{marginBottom:12}}>
                  ⚠ This will permanently delete both the DynamoDB record and the S3 artifact. <strong>This cannot be undone.</strong>
                </div>
              )}

              <label className="modal-label">Reason for deletion <span style={{color:'#dc2626'}}>*</span></label>
              <textarea
                ref={reasonRef}
                className="modal-textarea"
                rows={3}
                placeholder="e.g. Cleanup after failed test upload"
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
              />

              <label className="modal-label">
                Type <code>{deleteModal.version}</code> to confirm
              </label>
              <input
                className="modal-input"
                placeholder={deleteModal.version}
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
              />

              {coolingOff && (
                <div className="alert alert-warn" style={{marginTop:12}}>
                  ⏳ This package was superseded <strong>{coolingOff.supersededDaysAgo} day(s)</strong> ago (cooling-off: {coolingOff.coolingOffDays} days).
                  Offline devices may still need this version.
                  <label style={{display:'flex', alignItems:'center', gap:8, marginTop:8, cursor:'pointer'}}>
                    <input
                      type="checkbox"
                      checked={deleteForce}
                      onChange={e => setDeleteForce(e.target.checked)}
                    />
                    I understand — force delete anyway
                  </label>
                </div>
              )}

              {deleteModalError && !coolingOff && (
                <div className="alert alert-error" style={{marginTop:12}}>{deleteModalError}</div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeDeleteModal} disabled={deleteWorking}>
                Cancel
              </button>
              <button
                className="btn btn-delete"
                disabled={
                  deleteWorking ||
                  deleteConfirm !== deleteModal.version ||
                  !deleteReason.trim() ||
                  (coolingOff && !deleteForce)
                }
                onClick={() => submitDelete(deleteForce)}
              >
                {deleteWorking ? 'Deleting…' : '🗑 Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
