import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { ROLLOUT_STAGES, TARGET_TYPES } from '../config';
import { logger } from '../utils/logger';
import { audit }  from '../utils/audit';

const DEFAULT_FORM = {
  packageName:  '',
  version:      '',
  targetType:   'THING',
  targetId:     '',
  rolloutStage: 'PRODUCTION',
};

export default function DeploymentsPage() {
  const { token, logout } = useAuth();
  const [deployments, setDeployments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [showForm,    setShowForm]    = useState(false);
  const [form,        setForm]        = useState(DEFAULT_FORM);
  const [submitting,  setSubmitting]  = useState(false);
  const [successMsg,  setSuccessMsg]  = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    logger.debug('DeploymentsPage', 'Loading deployments');
    try {
      const { data } = await apiClient(token, logout).get('/ota/deployments');
      const jobs = data.jobs || [];
      setDeployments(jobs);
      logger.info('DeploymentsPage', 'Deployments loaded', { count: jobs.length });
    } catch (err) {
      const reason = err.response?.data?.error || err.response?.data?.message || 'Failed to load deployments';
      logger.error('DeploymentsPage', 'Failed to load deployments', { reason });
      setError(reason);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const resource = { packageName: form.packageName, version: form.version, targetType: form.targetType, targetId: form.targetId, rolloutStage: form.rolloutStage };
    logger.info('DeploymentsPage', 'Creating deployment', resource);
    audit.log('DEPLOYMENT_CREATE', resource, 'INITIATED');
    try {
      const { data } = await apiClient(token, logout).post('/ota/deployments', form);
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
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
            {showForm ? 'Cancel' : '+ New Deployment'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-4">
          <h3>Create Deployment</h3>
          <form onSubmit={handleCreate}>
            <div className="form-grid">
              <div className="field">
                <label>Package Name</label>
                <input
                  value={form.packageName}
                  onChange={e => setForm(f => ({ ...f, packageName: e.target.value }))}
                  placeholder="HomeAssistantUtility"
                  required
                />
              </div>
              <div className="field">
                <label>Version</label>
                <input
                  value={form.version}
                  onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                  placeholder="1.2.3"
                  required
                />
              </div>
              <div className="field">
                <label>Target Type</label>
                <select
                  value={form.targetType}
                  onChange={e => setForm(f => ({ ...f, targetType: e.target.value }))}
                >
                  {TARGET_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>{form.targetType === 'THING' ? 'Device ID' : 'Group Name'}</label>
                <input
                  value={form.targetId}
                  onChange={e => setForm(f => ({ ...f, targetId: e.target.value }))}
                  placeholder={form.targetType === 'THING' ? 'uuid' : 'DGX-Canary'}
                  required
                />
              </div>
              <div className="field">
                <label>Rollout Stage</label>
                <select
                  value={form.rolloutStage}
                  onChange={e => setForm(f => ({ ...f, rolloutStage: e.target.value }))}
                >
                  {ROLLOUT_STAGES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="form-actions mt-4">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
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
                <th>Job ID</th>
                <th>Package</th>
                <th>Version</th>
                <th>Target</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deployments.map(d => (
                <tr key={d.jobId}>
                  <td>
                    <code className="text-sm" title={d.jobId}>{d.jobId?.slice(-16)}</code>
                    <button className="btn-copy" title="Copy full Job ID" onClick={() => navigator.clipboard.writeText(d.jobId)}>⎘</button>
                  </td>
                  <td><strong>{d.packageName}</strong></td>
                  <td><code>{d.version}</code></td>
                  <td className="text-sm">{d.targetType}: {d.targetId}</td>
                  <td><span className="badge badge-grey">{d.rolloutStage}</span></td>
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
