const MAP = {
  ACTIVE:           'badge-green',
  COMPLETED:        'badge-green',
  PENDING:          'badge-yellow',
  CORRUPTED:        'badge-red',
  RECALLED:         'badge-orange',
  QUEUED:           'badge-blue',
  IN_PROGRESS:      'badge-blue',
  SUCCEEDED:        'badge-green',
  FAILED:           'badge-red',
  TIMED_OUT:        'badge-orange',
  CANCELLED:        'badge-grey',
  REJECTED:         'badge-red',
  AWAITING_CONSENT: 'badge-yellow',  // kept for backward compat with old records
  ACCEPTED:         'badge-green',
  DECLINED:         'badge-red',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`badge ${MAP[status] || 'badge-grey'}`}>
      {status}
    </span>
  );
}
