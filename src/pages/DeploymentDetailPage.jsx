import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { logger } from '../utils/logger';
import { audit }  from '../utils/audit';

export default function DeploymentDetailPage() {
  const { jobId }  = useParams();
  const { token }  = useAuth();
  const [job,      setJob]      = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [aborting, setAborting] = useState(false);

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
