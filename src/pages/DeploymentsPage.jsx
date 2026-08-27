import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import BetaUsersPanel from '../components/BetaUsersPanel';
import { ROLLOUT_STAGES, ROLLOUT_STAGE_LABELS, RELEASE_TYPE_LABELS } from '../config';
import { logger } from '../utils/logger';
import { audit }  from '../utils/audit';

const DEFAULT_FORM = {
  packageName:  '',
  version:      '',
  targetType:   'THING',
  targetId:     '',
  rolloutStage: 'PRODUCTION',
};

function sortDeployments(jobs, col, dir) {
  if (!col) return jobs;
  return [...jobs].sort((a, b) => {
    let av = a[col], bv = b[col];
    if (col === 'createdAt') return dir * ((av || 0) - (bv || 0));
    return dir * (av || '').toString().localeCompare((bv || '').toString());
  });
}

function filterDeployments(jobs, searches) {
  return jobs.filter(d => {
    for (const [col, val] of Object.entries(searches)) {
      if (!val || val.length < 3) continue;
      const v = val.toLowerCase();
      if (col === 'jobId'       && !(d.jobId       || '').toLowerCase().includes(v)) return false;
      if (col === 'packageName' && !(`${d.packageName || ''}-${d.version || ''}`).toLowerCase().includes(v)) return false;
      if (col === 'targetId'    && !(d.targetId    || '').toLowerCase().includes(v)) return false;
      if (col === 'rolloutStage'&& !(d.rolloutStage|| '').toLowerCase().includes(v)) return false;
      if (col === 'status'      && !(d.status      || '').toLowerCase().includes(v)) return false;
      if (col === 'createdAt') {
        const date = d.createdAt ? new Date(d.createdAt).toLocaleString() : '';
        if (!date.toLowerCase().includes(v)) return false;
      }
    }
    return true;
  });
}

export default function DeploymentsPage() {
  const { token, logout } = useAuth();
  const [deployments,    setDeployments]    = useState([]);
  const [activePackages, setActivePackages] = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [showForm,       setShowForm]       = useState(false);
  const [showBeta,       setShowBeta]       = useState(false);
  const [form,           setForm]           = useState(DEFAULT_FORM);
  const [betaUsers,        setBetaUsers]        = useState([]);
  const [selectedBetaIds,  setSelectedBetaIds]  = useState([]);
  const [customDeviceIds,  setCustomDeviceIds]  = useState([]);
  const [customDeviceInput,setCustomDeviceInput]= useState('');
  const [submitting,      setSubmitting]      = useState(false);
  const [successMsg,      setSuccessMsg]      = useState('');
  const [sortCol,         setSortCol]         = useState('');
  const [sortDir,         setSortDir]         = useState(1);
  const [activeSearchCol, setActiveSearchCol] = useState(null);
  const [columnSearches,  setColumnSearches]  = useState({});

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => -d);
    else { setSortCol(col); setSortDir(1); }
  };
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
    logger.debug('DeploymentsPage', 'Loading deployments');
    const client = apiClient(token, logout);
    try {
      const [deploymentsRes, packagesRes] = await Promise.all([
        client.get('/ota/deployments'),
        client.get('/ota/packages?status=ACTIVE'),
      ]);
      const jobs = deploymentsRes.data.jobs || [];
      setDeployments(jobs);
      setActivePackages(packagesRes.data.packages || []);
      logger.info('DeploymentsPage', 'Deployments loaded', { count: jobs.length });
    } catch (err) {
      const reason = err.response?.data?.error || err.response?.data?.message || 'Failed to load deployments';
      logger.error('DeploymentsPage', 'Failed to load deployments', { reason });
      setError(reason);
    } finally {
      setLoading(false);
    }
    // Load beta users independently — don't block deployments list if it fails
    try {
      const { data } = await client.get('/ota/beta-users');
      const users = data.users || [];
      setBetaUsers(users);
      setSelectedBetaIds(users.map(u => u.deviceId));
    } catch (err) {
      logger.warn('DeploymentsPage', 'Failed to load beta users', { reason: err.message });
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    // For BETA/CUSTOM, send targetIds — backend creates one job targeting all of them
    const payload = form.rolloutStage === 'BETA'
      ? { packageName: form.packageName, version: form.version, rolloutStage: form.rolloutStage, targetIds: selectedBetaIds }
      : form.rolloutStage === 'CUSTOM'
      ? { packageName: form.packageName, version: form.version, rolloutStage: form.rolloutStage, targetIds: customDeviceIds }
      : form;
    const resource = { packageName: form.packageName, version: form.version, rolloutStage: form.rolloutStage, ...(form.rolloutStage !== 'BETA' && { targetType: form.targetType, targetId: form.targetId }) };
    logger.info('DeploymentsPage', 'Creating deployment', resource);
    audit.log('DEPLOYMENT_CREATE', resource, 'INITIATED');
    try {
      const { data } = await apiClient(token, logout).post('/ota/deployments', payload);
      logger.info('DeploymentsPage', 'Deployment created', { jobId: data.jobId, ...resource });
      audit.log('DEPLOYMENT_CREATE', resource, 'SUCCESS', { jobId: data.jobId });
      setSuccessMsg(`Job created: ${data.jobId}`);
      setTimeout(() => setSuccessMsg(''), 5000);
      setShowForm(false);
      setForm(DEFAULT_FORM);
      load();
    } catch (err) {
      const reason = err.response?.data?.error || err.response?.data?.message || 'Failed to create deployment';
      logger.error('DeploymentsPage', 'Deployment creation failed', { ...resource, reason });
      audit.log('DEPLOYMENT_CREATE', resource, 'FAILURE', { reason });
      setError(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Deployments</h2>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setShowBeta(s => !s); setShowForm(false); }}>
            {showBeta ? 'Hide Beta Users' : 'Beta Users'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setShowForm(s => !s); setShowBeta(false); }}>
            {showForm ? 'Cancel' : '+ New Deployment'}
          </button>
        </div>
      </div>

      {showBeta && (
        <BetaUsersPanel token={token} logout={logout} onUsersChange={load} />
      )}

      {showForm && (
        <div className="card mb-4">
          <h3>Create Deployment</h3>
          <form onSubmit={handleCreate}>
            <div className="form-grid">
              <div className="field">
                <label>Package Name</label>
                <select
                  value={form.packageName}
                  onChange={e => setForm(f => ({ ...f, packageName: e.target.value, version: '' }))}
                  required
                >
                  <option value="">— Select package —</option>
                  {[...new Set(activePackages.map(p => p.packageName))].sort().map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Version</label>
                <select
                  value={form.version}
                  onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                  required
                  disabled={!form.packageName}
                >
                  <option value="">— Select version —</option>
                  {activePackages
                    .filter(p => p.packageName === form.packageName)
                    .sort((a, b) => b.version.localeCompare(a.version))
                    .map(p => (
                      <option key={p.version} value={p.version}>{p.version}</option>
                    ))
                  }
                </select>
              </div>
              <div className="field">
                <label>Rollout Stage</label>
                <select
                  value={form.rolloutStage}
                  onChange={e => setForm(f => ({ ...f, rolloutStage: e.target.value, targetId: '' }))}
                >
                  {ROLLOUT_STAGES.map(s => <option key={s} value={s}>{ROLLOUT_STAGE_LABELS[s] || s}</option>)}
                </select>
              </div>
              <div className="field">
                {form.rolloutStage === 'BETA' ? (
                  <>
                    <label>Beta Users</label>
                    {betaUsers.length === 0 ? (
                      <p className="text-muted" style={{ margin: '8px 0' }}>
                        No beta users configured. Add one via <strong>Beta Users</strong>.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={selectedBetaIds.length === betaUsers.length}
                            onChange={e => setSelectedBetaIds(e.target.checked ? betaUsers.map(u => u.deviceId) : [])}
                          />
                          Select All ({betaUsers.length} users)
                        </label>
                        <hr style={{ margin: '2px 0', borderColor: 'var(--border, #333)' }} />
                        <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '4px' }}>
                          {betaUsers.map(u => (
                            <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={selectedBetaIds.includes(u.deviceId)}
                                onChange={e => setSelectedBetaIds(prev =>
                                  e.target.checked ? [...prev, u.deviceId] : prev.filter(id => id !== u.deviceId)
                                )}
                              />
                              {u.email}
                            </label>
                          ))}
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary, #aaa)' }}>
                          {selectedBetaIds.length} of {betaUsers.length} selected
                        </p>
                      </div>
                    )}
                  </>
                ) : form.rolloutStage === 'CUSTOM' ? (
                  <>
                    <label>Device IDs (DUIDs)</label>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <input
                        value={customDeviceInput}
                        onChange={e => setCustomDeviceInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const id = customDeviceInput.trim();
                            if (id && !customDeviceIds.includes(id))
                              setCustomDeviceIds(prev => [...prev, id]);
                            setCustomDeviceInput('');
                          }
                        }}
                        placeholder="Paste device ID and press Enter"
                        style={{ flex: 1 }}
                      />
                      <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const id = customDeviceInput.trim();
                          if (id && !customDeviceIds.includes(id))
                            setCustomDeviceIds(prev => [...prev, id]);
                          setCustomDeviceInput('');
                        }}>
                        Add
                      </button>
                    </div>
                    {customDeviceIds.length > 0 && (
                      <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {customDeviceIds.map(id => (
                          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
                            background: 'var(--bg-secondary, #2a2a2a)', border: '1px solid var(--border, #444)',
                            borderRadius: '4px', padding: '2px 8px', fontSize: '0.8rem' }}>
                            <code>{id}</code>
                            <button type="button" onClick={() => setCustomDeviceIds(prev => prev.filter(d => d !== id))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: '0 2px' }}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                    {customDeviceIds.length > 0 && (
                      <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary, #aaa)' }}>
                        {customDeviceIds.length} device{customDeviceIds.length > 1 ? 's' : ''} selected
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <label>Device ID</label>
                    <input
                      value={form.targetId}
                      onChange={e => setForm(f => ({ ...f, targetId: e.target.value }))}
                      placeholder="uuid"
                      required
                    />
                  </>
                )}
              </div>
            </div>
            <div className="form-actions mt-4">
              <button type="submit" className="btn btn-primary"
                disabled={submitting ||
                  (form.rolloutStage === 'BETA'   && selectedBetaIds.length  === 0) ||
                  (form.rolloutStage === 'CUSTOM' && customDeviceIds.length  === 0)}>
                {submitting ? 'Creating…' : 'Create Deployment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {error      && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : deployments.length === 0 ? (
        <div className="empty">No deployments found.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {SearchSortTh('jobId',        'Job ID')}
                {SearchSortTh('packageName',  'Package / Version')}
                {SearchSortTh('targetId',     'Target')}
                {SearchSortTh('rolloutStage', 'Stage')}
                {SearchSortTh('status',       'Status')}
                {SearchSortTh('createdAt',    'Created')}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filterDeployments(sortDeployments(deployments, sortCol, sortDir), columnSearches).map(d => (
                <tr key={d.jobId} className={
                    d.status === 'SUCCEEDED'                        ? 'row-published'
                  : d.status === 'IN_PROGRESS'                      ? 'row-inprogress'
                  : d.status === 'QUEUED'                           ? 'row-queued'
                  : d.status === 'FAILED' || d.status === 'REJECTED'? 'row-recalled'
                  : d.status === 'CANCELLED'                        ? 'row-cancelled'
                  : ''
                }>
                  <td>
                    <code className="text-sm" title={d.jobId}>{d.jobId?.slice(-16)}</code>
                    <button className="btn-copy" title="Copy full Job ID" onClick={() => navigator.clipboard.writeText(d.jobId)}>⎘</button>
                  </td>
                  <td><strong>{d.packageName}-{d.version}</strong></td>
                  <td className="text-sm">{d.targetType}: {d.targetId}</td>
                  <td><span className="badge badge-grey">{ROLLOUT_STAGE_LABELS[d.rolloutStage] || d.rolloutStage}</span></td>
                  <td><StatusBadge status={d.status} /></td>
                  <td className="text-sm">{d.createdAt ? new Date(d.createdAt).toLocaleString() : '—'}</td>
                  <td>
                    <Link to={`/deployments/${d.jobId}`} className="btn btn-sm btn-ghost">
                      View →
                    </Link>
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
