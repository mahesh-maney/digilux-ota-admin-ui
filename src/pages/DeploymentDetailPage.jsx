import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { ROLLOUT_STAGE_LABELS } from '../config';
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
  const { token, logout } = useAuth();
  const navigate       = useNavigate();
  const [job,          setJob]          = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [aborting,       setAborting]       = useState(false);
  const [rollingBack,    setRollingBack]    = useState(false);
  const [showAbortModal, setShowAbortModal] = useState(false);
  const [abortReason,    setAbortReason]    = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    logger.debug('DeploymentDetailPage', 'Loading job', { jobId });
    try {
      const { data } = await apiClient(token, logout).get(`/ota/deployments/${jobId}`);
      setJob(data);
      logger.info('DeploymentDetailPage', 'Job loaded', {
        jobId,
        status:       data.status,
        packageName:  data.packageName,
        version:      data.version,
        deviceCount:  Object.keys(data.deviceStatuses || {}).length,
      });
    } catch (err) {
      const reason = err?.response?.data?.error || err?.response?.data?.message || 'Failed to load job';
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

  const handleAbort = () => {
    setAbortReason('');
    setShowAbortModal(true);
  };

  const handleAbortConfirm = async () => {
    if (!abortReason.trim()) return;
    setShowAbortModal(false);
    setAborting(true);
    logger.warn('DeploymentDetailPage', 'Abort initiated by user', { jobId });
    audit.log('DEPLOYMENT_ABORT', { jobId }, 'INITIATED');
    try {
      await apiClient(token, logout).post(`/ota/deployments/${jobId}/abort`, { reason: abortReason.trim() });
      logger.info('DeploymentDetailPage', 'Abort successful', { jobId });
      audit.log('DEPLOYMENT_ABORT', { jobId }, 'SUCCESS');
      setAbortReason('');
      load();
    } catch (err) {
      const reason = err?.response?.data?.error || err?.response?.data?.message || 'Abort failed';
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
      const client = apiClient(token, logout);

      // Step 1: scan deployment history — find the most recent COMPLETED/SUCCEEDED
      // deployment for the same package + stage with a different version.
      const { data: deplData } = await client.get('/ota/deployments');
      const history = (deplData.jobs || [])
        .filter(j =>
          j.packageName    === job.packageName &&
          j.rolloutStage   === job.rolloutStage &&
          (j.status === 'COMPLETED' || j.status === 'SUCCEEDED') &&
          j.version        !== job.version &&
          // for non-PRODUCTION, also match the same targetId
          (job.rolloutStage === 'PRODUCTION' || j.targetId === job.targetId)
        )
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      let rollbackVersion = history[0]?.version ?? null;

      // Step 2: fallback — if no succeeded history, pick the highest ACTIVE version
      if (!rollbackVersion) {
        const { data: pkgData } = await client.get('/ota/packages?status=ACTIVE');
        const candidates = (pkgData.packages || [])
          .filter(p => p.packageName === job.packageName && p.activated && p.version !== job.version)
          .sort((a, b) => compareSemver(b.version, a.version));
        rollbackVersion = candidates[0]?.version ?? null;
      }

      if (!rollbackVersion) {
        alert(
          `No previous version found to roll back to for ${job.packageName}.\n` +
          `Upload and publish an earlier version first.`
        );
        return;
      }

      // Step 3: verify the rollback version is still ACTIVE
      const { data: pkg } = await client.get(`/ota/packages/${job.packageName}/${rollbackVersion}`);
      if (pkg.status !== 'ACTIVE') {
        alert(
          `v${rollbackVersion} is currently ${pkg.status} and cannot be deployed.\n\n` +
          `Go to Packages → restore v${rollbackVersion} to ACTIVE first, then retry the rollback.`
        );
        return;
      }

      const fromHistory = history[0]?.version === rollbackVersion;
      const targetDesc = job.rolloutStage === 'PRODUCTION'
        ? 'All DGX-Production devices'
        : `${job.targetType}: ${job.targetId}`;
      const confirmed = confirm(
        `Create rollback deployment?\n\n` +
        `Package : ${job.packageName}\n` +
        `From    : v${job.version}\n` +
        `To      : v${rollbackVersion}${fromHistory ? '  (last successfully deployed version)' : ''}\n` +
        `Target  : ${targetDesc}\n` +
        `Stage   : ${job.rolloutStage}`
      );
      if (!confirmed) return;

      logger.info('DeploymentDetailPage', 'Rollback initiated', {
        jobId, packageName: job.packageName,
        fromVersion: job.version, toVersion: rollbackVersion, fromHistory,
      });
      audit.log('DEPLOYMENT_ROLLBACK', { jobId, packageName: job.packageName }, 'INITIATED', {
        fromVersion: job.version, toVersion: rollbackVersion,
      });

      const rollbackPayload = job.rolloutStage === 'PRODUCTION'
        ? { packageName: job.packageName, version: rollbackVersion, rolloutStage: job.rolloutStage }
        : { packageName: job.packageName, version: rollbackVersion, targetType: job.targetType, targetId: job.targetId, rolloutStage: job.rolloutStage };

      const { data: newJob } = await client.post('/ota/deployments', rollbackPayload);

      logger.info('DeploymentDetailPage', 'Rollback deployment created', { newJobId: newJob.jobId });
      audit.log('DEPLOYMENT_ROLLBACK', { jobId, packageName: job.packageName }, 'SUCCESS', {
        newJobId: newJob.jobId, toVersion: rollbackVersion,
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

  // Deployment-level terminal statuses (new schema: COMPLETED/CANCELLED/FAILED)
  // Also handle old records that may carry IoT-job-level statuses
  const terminal    = ['COMPLETED', 'CANCELLED', 'FAILED', 'SUCCEEDED'].includes(job?.status);
  const canRollback = ['COMPLETED', 'FAILED', 'TIMED_OUT', 'SUCCEEDED'].includes(job?.status);
  const isActiveDeployment = job?.status === 'ACTIVE';
  // backward compat: old records stored AWAITING_CONSENT at job level
  const awaitingConsent = isActiveDeployment || job?.status === 'AWAITING_CONSENT';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/deployments" className="back-link">← Deployments</Link>
          <h2>Deployment Detail</h2>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
          {canRollback && (
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

      {/* Abort reason modal */}
      {showAbortModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="card" style={{ width: 420, margin: 0 }}>
            <h3 style={{ marginTop: 0 }}>Abort Deployment</h3>
            <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
              This will cancel the deployment and stop new IoT jobs from being created.
              A reason is required.
            </p>
            <label className="form-label">Reason <span style={{ color: 'var(--danger)' }}>*</span></label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="e.g. Critical bug found in firmware v1.2.0"
              value={abortReason}
              onChange={e => setAbortReason(e.target.value)}
              autoFocus
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAbortModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={handleAbortConfirm}
                disabled={!abortReason.trim()}
              >
                Confirm Abort
              </button>
            </div>
          </div>
        </div>
      )}

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
                <span>
                  {job.rolloutStage === 'PRODUCTION'
                    ? 'All DGX-Production devices'
                    : job.targetId
                      ? `${job.targetType}: ${job.targetId}`
                      : '—'
                  }
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Rollout Stage</span>
                <span><span className="badge badge-grey">{ROLLOUT_STAGE_LABELS[job.rolloutStage] || job.rolloutStage}</span></span>
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

          {/* Completed deployment notice */}
          {job.status === 'COMPLETED' && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              <strong>Deployment completed.</strong>{' '}
              All target devices have finished processing this update.
            </div>
          )}

          {/* Failed deployment notice */}
          {job.status === 'FAILED' && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              <strong>This deployment failed on one or more devices.</strong>{' '}
              Affected devices will automatically see the latest available firmware in the next update check —
              the failed job does not block future updates.
              Use <strong>Rollback</strong> to revert to the previous version, or create a new deployment with a newer firmware.
            </div>
          )}

          {/* Timed-out deployment notice */}
          {job.status === 'TIMED_OUT' && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              <strong>This deployment timed out.</strong>{' '}
              One or more devices did not complete the update within the allowed window.
              Affected devices are unblocked and will see the latest available firmware on their next update check.
              Use <strong>Rollback</strong> to revert to the previous version, or create a new deployment to retry.
            </div>
          )}

          {/* Consent stats — shown for active/consent-gated deployments */}
          {(awaitingConsent || job.consentStats) && (
            <div className="card mb-4">
              <h3>User Consent</h3>
              {isActiveDeployment && (
                <p className="text-sm text-muted" style={{ marginBottom: 14 }}>
                  Deployment is active. IoT jobs are created per-device once each user consents.
                  Devices that decline will see the update again on their next check.
                </p>
              )}
              {job?.status === 'AWAITING_CONSENT' && !isActiveDeployment && (
                <p className="text-sm text-muted" style={{ marginBottom: 14 }}>
                  Waiting for device owners to approve this update. IoT Jobs will be created per-device once each user consents.
                </p>
              )}
              {/* Consent-level stats (from consents table) */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                {[
                  { label: 'Pending',  key: 'PENDING',  cls: 'badge-blue'   },
                  { label: 'Accepted', key: 'ACCEPTED', cls: 'badge-green'  },
                  { label: 'Declined', key: 'DECLINED', cls: 'badge-red'    },
                ].map(({ label, key, cls }) => (
                  <div key={key} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '12px 20px', minWidth: 90,
                  }}>
                    <span style={{ fontSize: 24, fontWeight: 700 }}>
                      {job.consentStats?.[key] ?? '—'}
                    </span>
                    <span className={`badge ${cls}`} style={{ marginTop: 4 }}>{label}</span>
                  </div>
                ))}
                {job.consentCount != null && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '12px 20px', minWidth: 90,
                  }}>
                    <span style={{ fontSize: 24, fontWeight: 700 }}>{job.consentCount}</span>
                    <span className="badge badge-grey" style={{ marginTop: 4 }}>Total</span>
                  </div>
                )}
              </div>
              {/* Deployment-level execution counters */}
              {job.counters && (
                <>
                  <p className="text-sm text-muted" style={{ margin: '8px 0 6px' }}>Execution outcomes:</p>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Succeeded', key: 'succeeded', cls: 'badge-green'  },
                      { label: 'Failed',    key: 'failed',    cls: 'badge-red'    },
                      { label: 'Timed Out', key: 'timedOut',  cls: 'badge-orange' },
                      { label: 'Cancelled', key: 'cancelled', cls: 'badge-grey'   },
                    ].filter(({ key }) => job.counters[key] != null).map(({ label, key, cls }) => (
                      <div key={key} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 8, padding: '12px 20px', minWidth: 90,
                      }}>
                        <span style={{ fontSize: 24, fontWeight: 700 }}>{job.counters[key]}</span>
                        <span className={`badge ${cls}`} style={{ marginTop: 4 }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {job.deviceStatuses && Object.keys(job.deviceStatuses).length > 0 && (
            <div className="card">
              <h3>Device Progress</h3>
              {job.createdAt && (
                <p className="text-sm text-muted" style={{ marginTop: '-4px', marginBottom: '12px' }}>
                  Deployment created: {new Date(job.createdAt).toLocaleString()}
                </p>
              )}
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
