/**
 * Structured logger — levels: DEBUG | INFO | WARN | ERROR
 * Dev: coloured console output with component context
 * Prod: JSON-structured lines (pipe to CloudWatch / Datadog / etc.)
 */

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

// In prod suppress DEBUG; in dev show everything
const MIN_LEVEL = import.meta.env.PROD ? LEVELS.INFO : LEVELS.DEBUG;

const COLORS = {
  DEBUG: 'color:#6b7280',
  INFO:  'color:#2563eb',
  WARN:  'color:#d97706;font-weight:600',
  ERROR: 'color:#dc2626;font-weight:700',
};

function emit(level, component, message, data) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const entry = {
    ts:        new Date().toISOString(),
    level,
    component,
    message,
    ...(data && Object.keys(data).length ? { data } : {}),
  };

  if (import.meta.env.PROD) {
    const fn = level === 'ERROR' ? console.error
             : level === 'WARN'  ? console.warn
             : console.log;
    fn(JSON.stringify(entry));
  } else {
    const prefix = `%c[${level}] ${entry.ts} [${component}]`;
    const fn = level === 'ERROR' ? console.error
             : level === 'WARN'  ? console.warn
             : console.log;
    if (data && Object.keys(data).length) {
      fn(prefix, COLORS[level], message, data);
    } else {
      fn(prefix, COLORS[level], message);
    }
  }
}

export const logger = {
  debug: (component, message, data) => emit('DEBUG', component, message, data),
  info:  (component, message, data) => emit('INFO',  component, message, data),
  warn:  (component, message, data) => emit('WARN',  component, message, data),
  error: (component, message, data) => emit('ERROR', component, message, data),
};
