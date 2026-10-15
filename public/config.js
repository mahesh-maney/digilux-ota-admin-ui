// Runtime configuration for the Digilux OTA Admin UI.
// This file is served as-is from S3 — edit it here and re-upload (no rebuild needed).
// All values have safe defaults in src/config.js; omit a key to use the default.
window._appConfig = {
  // Login rate limiting
  LOGIN_MAX_ATTEMPTS:  5,   // failed attempts before lockout
  LOGIN_LOCKOUT_SECS:  30,  // seconds the login form is locked after too many failures

  // Session idle timeout
  IDLE_TIMEOUT_MINS:   30,  // minutes of inactivity before auto-logout
};
