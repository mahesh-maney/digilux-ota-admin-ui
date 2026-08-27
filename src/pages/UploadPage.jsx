import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import ProgressBar from '../components/ProgressBar';
import StatusBadge from '../components/StatusBadge';
import { sha256 } from 'js-sha256';
import { DEVICE_TYPES, CHUNK_SIZE } from '../config';
import { logger } from '../utils/logger';
import { audit }  from '../utils/audit';

// Compute SHA256 in browser — uses Web Crypto API when available (HTTPS/localhost),
// falls back to js-sha256 (pure JS) for HTTP environments.
async function computeSHA256(file) {
  const buffer = await file.arrayBuffer();
  if (crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256(buffer);
}

// Upload chunks with concurrency limit of 3
async function uploadChunks(chunkUrls, file, chunkSize, onProgress) {
  const CONCURRENCY = 3;
  const etags = [];
  let completed = 0;

  logger.info('UploadPage', 'Multipart chunk upload started', {
    totalChunks: chunkUrls.length,
    chunkSize,
    concurrency: CONCURRENCY,
  });

  for (let i = 0; i < chunkUrls.length; i += CONCURRENCY) {
    const batch = chunkUrls.slice(i, i + CONCURRENCY);
    logger.debug('UploadPage', 'Uploading chunk batch', {
      parts: batch.map(c => c.partNumber),
    });
    const results = await Promise.all(
      batch.map(async ({ partNumber, url }) => {
        const start    = (partNumber - 1) * chunkSize;
        const end      = Math.min(start + chunkSize, file.size);
        const blob     = file.slice(start, end);
        const byteSize = end - start;

        logger.debug('UploadPage', `Uploading chunk ${partNumber}`, { byteSize, start, end });

        const resp = await fetch(url, {
          method: 'PUT',
          body:   blob,
          headers: { 'Content-Type': 'application/octet-stream' },
        });

        if (!resp.ok) {
          logger.error('UploadPage', `Chunk ${partNumber} failed`, { status: resp.status });
          throw new Error(`Chunk ${partNumber} upload failed (HTTP ${resp.status})`);
        }

        const etag = resp.headers.get('ETag') || resp.headers.get('etag') || `"chunk-${partNumber}"`;
        completed++;
        logger.debug('UploadPage', `Chunk ${partNumber} complete`, { etag, completed, total: chunkUrls.length });
        onProgress(completed, chunkUrls.length);
        return { partNumber, etag };
      })
    );
    etags.push(...results);
  }

  logger.info('UploadPage', 'All chunks uploaded', { totalChunks: chunkUrls.length });
  return etags.sort((a, b) => a.partNumber - b.partNumber);
}

export default function UploadPage() {
  const { token, logout } = useAuth();

  const [form, setForm] = useState({
    deviceType:   DEVICE_TYPES[0],
    version:      '',
    releaseType:  'BETA',
    releaseNotes: '',
  });
  const [file,     setFile]     = useState(null);
  const [checksum, setChecksum] = useState('');
  const [hashing,  setHashing]  = useState(false);
  const [stage,    setStage]    = useState('idle'); // idle | uploading | polling | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState('');

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size === 0) {
      setError('Selected file is empty (0 bytes). Please choose a valid firmware file.');
      e.target.value = '';
      return;
    }
    setFile(f);
    setChecksum('');
    setResult(null);
    setError('');
    setHashing(true);

    const uploadMode = f.size > 10 * 1024 * 1024 ? 'MULTIPART' : 'SINGLE';
    logger.info('UploadPage', 'File selected', {
      name:       f.name,
      sizeMB:     (f.size / 1024 / 1024).toFixed(2),
      type:       f.type,
      uploadMode,
    });

    try {
      logger.debug('UploadPage', 'Computing SHA256…', { fileName: f.name });
      const hash = await computeSHA256(f);
      setChecksum(hash);
      logger.info('UploadPage', 'SHA256 computed', { sha256: hash, fileName: f.name });
    } catch (err) {
      logger.error('UploadPage', 'SHA256 computation failed', { fileName: f.name, error: err.message });
      setError(`Failed to compute file checksum: ${err.message}`);
    } finally {
      setHashing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !checksum || hashing) return;
    setError('');
    setResult(null);
    setStage('uploading');

    const resource = { packageName: undefined, version: form.version, deviceType: form.deviceType, releaseType: form.releaseType, fileName: file.name, sizeMB: (file.size / 1024 / 1024).toFixed(2) };
    logger.info('UploadPage', 'Upload submitted', resource);

    try {
      const client = apiClient(token, logout);

      // ── Step 1: Initiate upload ───────────────────────────────────────────
      logger.info('UploadPage', 'Step 1: Requesting upload session', { ...resource, checksum, totalSize: file.size });
      const { data } = await client.post('/ota/packages/upload-artefact', {
        ...form,
        checksum,
        totalSize: file.size,
      });

      resource.packageName = data.packageName;
      logger.info('UploadPage', 'Upload session created', {
        uploadType:  data.uploadType,
        packageName: data.packageName,
        version:     data.version,
        totalChunks: data.totalChunks,
        uploadId:    data.uploadId,
      });
      audit.log('UPLOAD_INITIATED', { packageName: data.packageName, version: data.version }, 'INITIATED', {
        uploadType: data.uploadType,
        sizeMB:     resource.sizeMB,
        deviceType: form.deviceType,
        releaseType: form.releaseType,
      });

      if (data.uploadType === 'SINGLE') {
        // ── SINGLE: one PUT to S3 ─────────────────────────────────────────
        logger.info('UploadPage', 'Step 2 (SINGLE): PUT to S3', { packageName: data.packageName, version: data.version });
        setProgress({ done: 0, total: 1 });
        const resp = await fetch(data.uploadUrl, {
          method: 'PUT',
          body:   file,
          headers: {
            'Content-Type':            'application/octet-stream',
            'x-amz-meta-upload-token': data.uploadToken,
          },
        });
        if (!resp.ok) {
          logger.error('UploadPage', 'S3 single PUT failed', { status: resp.status });
          throw new Error(`S3 upload failed (HTTP ${resp.status})`);
        }
        setProgress({ done: 1, total: 1 });
        logger.info('UploadPage', 'S3 single PUT complete');

      } else {
        // ── MULTIPART: PUT chunks in parallel ─────────────────────────────
        logger.info('UploadPage', 'Step 2 (MULTIPART): uploading chunks', {
          totalChunks: data.totalChunks,
          chunkSize:   data.chunkSize,
          uploadId:    data.uploadId,
        });
        setProgress({ done: 0, total: data.totalChunks });
        const etags = await uploadChunks(
          data.chunkUrls, file, data.chunkSize,
          (done, total) => setProgress({ done, total }),
        );

        // ── Complete multipart upload ──────────────────────────────────────
        logger.info('UploadPage', 'Step 2b: completing multipart upload', {
          packageName: data.packageName,
          version:     data.version,
          parts:       etags.length,
        });
        await client.post('/ota/packages/upload-artefact/complete', {
          packageName: data.packageName,
          version:     data.version,
          parts:       etags,
        });
        logger.info('UploadPage', 'Multipart complete call succeeded');
      }

      // ── Step 3: Poll for ACTIVE / CORRUPTED ──────────────────────────────
      setStage('polling');
      const { packageName, version } = data;
      logger.info('UploadPage', 'Step 3: polling for artifact status', { packageName, version });
      let pkg = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const { data: s } = await client.get(`/ota/packages/${packageName}/${version}`);
        pkg = s;
        logger.debug('UploadPage', `Poll ${i + 1}/30`, { packageName, version, status: s.status });
        if (s.status === 'ACTIVE' || s.status === 'CORRUPTED') {
          logger.info('UploadPage', `Artifact processor finished — status: ${s.status}`, { packageName, version });
          break;
        }
      }

      const finalStatus = pkg?.status || 'UNKNOWN';
      if (finalStatus === 'ACTIVE') {
        audit.log('UPLOAD_COMPLETE', { packageName, version }, 'SUCCESS', {
          sizeMB:      (pkg.artifactSize / 1024 / 1024).toFixed(2),
          sha256:      pkg.sha256,
          uploadType:  data.uploadType,
        });
      } else {
        audit.log('UPLOAD_COMPLETE', { packageName, version }, 'FAILURE', {
          status:      finalStatus,
          corruptReason: pkg?.corruptReason,
        });
      }

      setResult(pkg);
      setStage('done');

    } catch (err) {
      const reason = err.response?.data?.error || err.message || 'Upload failed';
      logger.error('UploadPage', 'Upload flow failed', { resource, reason });
      audit.log('UPLOAD_COMPLETE', { packageName: resource.packageName, version: resource.version }, 'FAILURE', { reason });
      setError(reason);
      setStage('error');
    }
  };

  const reset = () => {
    logger.debug('UploadPage', 'Form reset');
    setFile(null);
    setChecksum('');
    setStage('idle');
    setProgress({ done: 0, total: 0 });
    setResult(null);
    setError('');
    setForm(f => ({ ...f, version: '', releaseNotes: '' }));
  };

  const busy = stage === 'uploading' || stage === 'polling' || hashing;

  return (
    <div className="page">
      <div className="page-header">
        <h2>Upload Artefact</h2>
        <p className="page-sub">Files ≤ 10 MB use single upload. Files &gt; 10 MB use automatic multipart chunking.</p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>Device Type</label>
              <select
                value={form.deviceType}
                onChange={e => setForm(f => ({ ...f, deviceType: e.target.value }))}
                disabled={busy}
              >
                {DEVICE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div className="field">
              <label>Version</label>
              <input
                value={form.version}
                onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                placeholder="1.2.3"
                required
                disabled={busy}
              />
            </div>

            <div className="field">
              <label>Release Notes</label>
              <input
                value={form.releaseNotes}
                onChange={e => setForm(f => ({ ...f, releaseNotes: e.target.value }))}
                placeholder="Optional"
                disabled={busy}
              />
            </div>
          </div>

          <div className="field mt-4">
            <label>Firmware File</label>
            <input
              type="file"
              onChange={handleFile}
              disabled={busy}
              className="file-input"
            />
          </div>

          {file && (
            <div className="file-info">
              <span>{file.name}</span>
              <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              {hashing && <span className="text-muted">Computing SHA256…</span>}
              {checksum && (
                <span className="checksum" title={checksum}>
                  SHA256: {checksum.slice(0, 16)}…
                </span>
              )}
              <span className="badge badge-blue">
                {file.size > 10 * 1024 * 1024 ? 'MULTIPART' : 'SINGLE'}
              </span>
            </div>
          )}

          {(stage === 'uploading' || stage === 'polling') && (
            <div className="mt-4">
              {stage === 'uploading' && (
                <ProgressBar done={progress.done} total={progress.total} />
              )}
              {stage === 'polling' && (
                <p className="text-muted pulse">Waiting for artifact_processor to verify… (up to 30s)</p>
              )}
            </div>
          )}

          {error && <div className="alert alert-error mt-4">{error}</div>}

          {result && (
            <div className={`alert ${result.status === 'ACTIVE' ? 'alert-success' : 'alert-error'} mt-4`}>
              <strong>{result.packageName} v{result.version}</strong> — <StatusBadge status={result.status} />
              {result.status === 'ACTIVE' && (
                <span> · {(result.artifactSize / 1024 / 1024).toFixed(2)} MB · SHA256: {result.sha256?.slice(0, 16)}…</span>
              )}
              {result.corruptReason && <span> · Reason: {result.corruptReason}</span>}
            </div>
          )}

          <div className="form-actions mt-4">
            {stage === 'done' || stage === 'error'
              ? <button type="button" className="btn btn-secondary" onClick={reset}>Upload Another</button>
              : (
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!file || !checksum || busy}
                >
                  {stage === 'uploading' ? 'Uploading…'
                    : stage === 'polling' ? 'Processing…'
                    : 'Upload'}
                </button>
              )
            }
          </div>
        </form>
      </div>
    </div>
  );
}
