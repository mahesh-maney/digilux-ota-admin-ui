# OTA Admin UI — Deployment Guide

Builds the React admin interface and syncs it to S3 in one command.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js + npm | v18+ |
| AWS CLI | v2+ configured with S3/CloudFront permissions |

Your S3 bucket must already exist and be configured for static website hosting (or served via CloudFront).

---

## 1 — Configure

```bash
cp deploy.config.template deploy.config
```

Open `deploy.config` and fill in the values:

| Variable | Required | Description |
|----------|----------|-------------|
| `REGION` | Yes | AWS region, e.g. `ap-south-1` |
| `S3_BUCKET` | Yes | S3 bucket name for the admin UI |
| `API_BASE` | Yes | Full OTA API base URL, e.g. `https://xyz.execute-api.ap-south-1.amazonaws.com/smarthome/api/v1` |
| `COGNITO_URL` | Yes | Cognito base URL, e.g. `https://cognito-idp.ap-south-1.amazonaws.com/` |
| `COGNITO_CLIENT` | Yes | Admin Cognito App Client ID |
| `CLOUDFRONT_DIST_ID` | No | CloudFront distribution ID — enables cache invalidation after deploy |
| `LOGO_FILE` | No | Path to a PNG/SVG/JPG logo file. Leave blank to use the existing `public/brand-logo.png`. |
| `BRAND_NAME` | No | Name shown in the navbar (default: `OTA Admin`) |
| `APP_SUBTITLE` | No | Subtitle on the login page (default: `OTA Admin`) |

`deploy.config` is gitignored — it will never be committed.

---

## 2 — Preflight (optional but recommended)

Validates all config values and AWS access before building:

```bash
./preflight.sh
```

Checks: tools present, config values set, AWS credentials valid, S3 bucket accessible, API URL reachable, logo file exists, Node ≥ 18.

---

## 3 — Deploy

```bash
./deploy.sh
```

What it does:
1. Copies logo to `public/brand-logo.<ext>` (if `LOGO_FILE` is set)
2. Writes `.env.production` from your config values
3. Runs `npm install` + `npm run build`
4. Syncs `dist/` to S3 — versioned assets with 1-year cache, `index.html` with no-cache
5. Invalidates CloudFront cache (if `CLOUDFRONT_DIST_ID` is set)

A timestamped log is written to `/tmp/ota_admin_ui_deploy_YYYYMMDD_HHMMSS.log`.

### Flags

| Flag | Effect |
|------|--------|
| `--build-only` | Build locally, do not sync to S3 |
| `--skip-preflight` | Skip validation checks |
| `--config path/to.config` | Use a different config file |

---

## Notes

- `.env.production` is auto-generated on every deploy — do not edit by hand.
- To change any API or Cognito value, update `deploy.config` and re-run `./deploy.sh`.
- If you have multiple environments (dev/prod), keep a separate config file for each and use `--config`.
