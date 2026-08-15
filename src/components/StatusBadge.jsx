const MAP = {
  ACTIVE:      'badge-green',
  PENDING:     'badge-yellow',
  CORRUPTED:   'badge-red',
  RECALLED:    'badge-orange',
  QUEUED:      'badge-blue',
  IN_PROGRESS: 'badge-blue',
  SUCCEEDED:   'badge-green',
  FAILED:      'badge-red',
  CANCELLED:   'badge-grey',
  REJECTED:    'badge-red',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`badge ${MAP[status] || 'badge-grey'}`}>
      {status}
    </span>
  );
}
