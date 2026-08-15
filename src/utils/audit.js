/**
 * Audit logger — strict event trail for every user action.
 *
 * Each entry:
 *   ts        ISO timestamp
 *   actor     logged-in email (set via audit.setActor after login)
 *   action    e.g. LOGIN | LOGOUT | UPLOAD_INITIATED | PACKAGE_ACTIVATE …
 *   resource  object describing what was acted on
 *   result    INITIATED | SUCCESS | FAILURE
 *   ...meta   any extra fields (jobId, uploadType, error reason, etc.)
 *
 * In dev: window.__AUDIT_LOG__() returns full in-memory log for inspection.
 */

import { logger } from './logger';

const MAX_ENTRIES = 1000;
const _log = [];
let _actor = 'anonymous';

const audit = {
  setActor(email) {
    _actor = email || 'anonymous';
  },

  log(action, resource, result, meta = {}) {
    const entry = {
      ts:       new Date().toISOString(),
      actor:    _actor,
      action,
      resource,
      result,
      ...meta,
    };

    // Ring buffer
    _log.unshift(entry);
    if (_log.length > MAX_ENTRIES) _log.pop();

    // Route through structured logger so it appears in the same console stream
    if (result === 'FAILURE') {
      logger.error('AUDIT', `${action} → FAILURE`, entry);
    } else if (result === 'INITIATED') {
      logger.info('AUDIT', `${action} → INITIATED`, entry);
    } else {
      logger.info('AUDIT', `${action} → SUCCESS`, entry);
    }

    return entry;
  },

  getLog: () => [..._log],
};

if (import.meta.env.DEV) {
  window.__AUDIT_LOG__ = audit.getLog;
  window.__AUDIT_CLEAR__ = () => { _log.length = 0; };
}

export { audit };
