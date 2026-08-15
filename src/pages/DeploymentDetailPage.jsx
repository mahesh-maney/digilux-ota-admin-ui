import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import StatusBadge from '../components/StatusBadge';
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

export default function DeploymentDetailPage() {
  const { jobId }      = useParams();
  const { token }      = useAuth();
  const navigate       = useNavigate();
  const [job,          setJob]          = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [aborting,     setAborting]     = useState(false);
  const [rollingBack,  setRollingBack]  = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    logger.debug('DeploymentDetailPage', 'Loading job', { jobId });
    try {
      const { data } = await apiClient(token).get(`/ota/deployments/${jobId}`);
      setJob(data);
      logger.info('DeploymentDetailPage', 'Job loaded', {
        jobId,
        status:       data.status,
        packageName:  data.packageName,
        version:      data.version,
        deviceCount:  Object.keys(data.deviceStatuses || {}).length,
      });
    } catch (err) {
      const reason = err.response?.data?.error || 'Failed to load job';
      logger.error('DeploymentDetailPage', 'Failed to load job', { jobId, reason });
      setError(reason);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    logger.info('DeploymentDetailPage', 'Viewing deployment', { jobId });
    audit.log('DEPLOYMENT_VIEW', { jobId }, 'INITIATED');
    load();
  }, [jobId]);

  const handleAbort = async () => {
    if (!confirm('Abort this deployment?')) return;
    setAborting(true);
    logger.warn('DeploymentDetailPage', 'Abort initiated by user', { jobId });
    audit.log('DEPLOYMENT_ABORT', { jobId }, 'INITIATED');
    try {
      await apiClient(token).post(`/ota/deployments/${jobId}/abort`);
      logger.info('DeploymentDetailPage', 'Abort successful', { jobId });
      audit.log('DEPLOYMENT_ABORT', { jobId }, 'SUCCESS');
      load();
    } catch (err) {
      const reason = err.response?.data?.error || 'Abort failed';
      logger.error('DeploymentDetailPage', 'Abort failed', { jobId, reason });
      audit.log('DEPLOYMENT_ABORT', { jobId }, 'FAILURE', { reason });
      setError(reason);
    } finally {
      setAborting(false);
    }
  };

  const handleRollback = async () => {
    setRollingBack(true);
    setError('');
    try {
      const { data } = await apiClient(token).get('/ota/packages?status=ACTIVE');
      const allPkgs  = data.packages || [];

      const candidates = allPkgs
        .filter(p => p.packageName === job.packageName && p.activated && p.version !== job.version)
        .sort((a, b) => compareSemver(b.version, a.version));

      const prev = candidates[0];

      if (!prev) {
        alert(`No previous active version found for ${job.packageName}.\nUpload and publish an earlier version first.`);
        return;
      }

      const confirmed = confirm(
        `Create rollback deployment?\n\n` +
        `Package:  ${job.packageName}\n` +
        `From:     v${job.version}\n` +
        `To:       v${prev.version}\n` +
        `Target:   ${job.targetType}: ${job.targetId}\n` +
        `Stage:    ${job.rolloutStage}`,
      );
      if (!confirmed) return;

      logger.info('DeploymentDetailPage', 'Rollback initiated', {
        jobId, packageName: job.packageName,
        fromVersion: job.version, toVersion: prev.version,
      });
      audit.log('DEPLOYMENT_ROLLBACK', { jobId, packageName: job.packageName }, 'INITIATED', {
        fromVersion: job.version, toVersion: prev.version,
      });

      const { data: newJob } = await apiClient(token).post('/ota/deployments', {
        packageName:  job.packageName,
        version:      prev.version,
        targetType:   job.targetType,
        targetId:     job.targetId,
        rolloutStage: job.rolloutStage,
      });

      logger.info('DeploymentDetailPage', 'Rollback deployment created', { newJobId: newJob.jobId });
      audit.log('DEPLOYMENT_ROLLBACK', { jobId, packageName: job.packageName }, 'SUCCESS', {
        newJobId: newJob.jobId, toVersion: prev.version,
      });

      navigate(`/deployments/${newJob.jobId}`);

    } catch (err) {
      const reason = err.response?.data?.error || err.message || 'Rollback failed';
      logger.error('DeploymentDetailPage', 'Rollback failed', { jobId, reason });
      audit.log('DEPLOYMENT_ROLLBACK', { jobId }, 'FAILURE', { reason });
      setError(reason);
    } finally {
      setRollingBack(false);
    }
  };

  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job?.status);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/deployments" className="back-link">← Deployments</Link>
          <h2>Deployment Detail</h2>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
          {job && (
            <button
              className="btn btn-warning btn-sm"
              onClick={handleRollback}
              disabled={rollingBack}
            >
              {rollingBack ? 'Finding version…' : '↩ Rollback'}
            </button>
          )}
          {!terminal && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleAbort}
              disabled={aborting}
            >
              {aborting ? 'Aborting…' : 'Abort'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="text-muted">Loading…</div>}

      {job && (
        <>
          <div className="card mb-4">
            <div className="detail-grid">
              <div className="detail-row">
                <span className="detail-label">Job ID</span>
                <span><code>{job.jobId}</code></span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Package</span>
                <span>{job.packageName} <code>v{job.version}</code></span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Target</span>
                <span>{job.targetType}: {job.targetId}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Rollout Stage</span>
                <span><span className="badge badge-grey">{job.rolloutStage}</span></span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Status</span>
                <span>
                  <StatusBadge status={job.status} />
                  {job.iotJobStatus && job.iotJobStatus !== job.status && (
                    <span className="text-muted text-sm ml-2">IoT: {job.iotJobStatus}</span>
                  )}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Created</span>
                <span>{job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}</span>
              </div>
              {job.iotJobArn && (
                <div className="detail-row">
                  <span className="detail-label">IoT Job ARN</span>
                  <span className="text-sm text-muted">{job.iotJobArn}</span>
                </div>
              )}
            </div>
          </div>

          {job.deviceStatuses && Object.keys(job.deviceStatuses).length > 0 && (
            <div className="card">
              <h3>Device Progress</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Thing Name</th>
                      <th>Status</th>
                      <th>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(job.deviceStatuses).map(([thing, info]) => (
                      <tr key={thing}>
                        <td><code>{thing}</code></td>
                        <td><StatusBadge status={info.status || info} /></td>
                        <td className="text-sm">
                          {info.lastUpdatedAt ? new Date(info.lastUpdatedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
