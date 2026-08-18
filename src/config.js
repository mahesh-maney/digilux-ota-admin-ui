// ─── Branding ─────────────────────────────────────────────────────────────
export const LOGO_URL     = import.meta.env.VITE_LOGO_URL     || '';
export const BRAND_NAME   = import.meta.env.VITE_BRAND_NAME   || 'Digilux';
export const APP_SUBTITLE = import.meta.env.VITE_APP_SUBTITLE || 'OTA Admin';

// ─── Navigation labels ────────────────────────────────────────────────────
export const NAV_UPLOAD      = import.meta.env.VITE_NAV_UPLOAD      || 'Upload';
export const NAV_PACKAGES    = import.meta.env.VITE_NAV_PACKAGES    || 'Packages';
export const NAV_DEPLOYMENTS = import.meta.env.VITE_NAV_DEPLOYMENTS || 'Deployments';

// ─── API & Auth ───────────────────────────────────────────────────────────
export const API_BASE       = import.meta.env.VITE_API_BASE       || 'https://iot.digilux.co.in/smarthome/api/v1';
export const COGNITO_URL    = import.meta.env.VITE_COGNITO_URL    || 'https://cognito-idp.ap-south-1.amazonaws.com/';
export const COGNITO_CLIENT = import.meta.env.VITE_COGNITO_CLIENT || '2qmig1uh220ttntbl0gfvcde4f';

// ─── Upload ───────────────────────────────────────────────────────────────
export const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

export const DEVICE_TYPES = (import.meta.env.VITE_DEVICE_TYPES || '')
  .split(',')
  .map(t => t.trim())
  .filter(Boolean)
  .length
  ? (import.meta.env.VITE_DEVICE_TYPES || '').split(',').map(t => t.trim()).filter(Boolean)
  : [
      'Network_controller_firmware',
      'Network_controller_zigbee_firmware',
      'Network_controller_Z2M_Firmware',
      'Network_controller_Miscellaneous',
    ];

// ─── Fixed enums (not customer-configurable) ──────────────────────────────
export const RELEASE_TYPES  = ['PROD', 'UAT'];
export const ROLLOUT_STAGES = ['CANARY', 'UAT', 'PRODUCTION', 'BETA'];
