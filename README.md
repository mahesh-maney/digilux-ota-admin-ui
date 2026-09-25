# Digilux OTA Admin — Web Interface

A React-based admin dashboard for managing Over-The-Air (OTA) firmware updates for Digilux IoT devices. It provides upload management, package lifecycle control, and deployment orchestration via AWS IoT Jobs.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Setup & Configuration](#setup--configuration)
5. [Running Locally](#running-locally)
6. [Authentication](#authentication)
7. [Pages & Features](#pages--features)
8. [API Reference](#api-reference)
   - [Authentication](#1-authentication-aws-cognito)
   - [Upload Artefact (Initiate)](#2-initiate-upload)
   - [Complete Multipart Upload](#3-complete-multipart-upload)
   - [List Packages](#4-list-packages)
   - [Get Package](#5-get-package)
   - [Activate / Withdraw / Recall Package](#6-activate--withdraw--recall-package)
   - [List Deployments](#7-list-deployments)
   - [Create Deployment](#8-create-deployment)
   - [Get Deployment Detail](#9-get-deployment-detail)
   - [Abort Deployment](#10-abort-deployment)
   - [Device — Check for Available Updates](#11-device--check-for-available-updates)
   - [User — Respond to Consent Request](#12-user--respond-to-consent-request)
9. [Upload Flow](#upload-flow)
   - [Step 0 — Fill in the form](#step-0--fill-in-the-form)
   - [Step 1 — File selection and hashing](#step-1--you-pick-a-file-and-the-browser-hashes-it-immediately)
   - [Step 2 — Initiate upload](#step-2--initiate-upload-backend-registers-the-package)
   - [Step 3 — Binary upload to S3](#step-3--binary-upload-to-s3-directly-from-your-browser)
   - [Step 4 — artifact_processor](#step-4--backend-processes-the-binary-artifact_processor-lambda)
10. [Package Lifecycle](#package-lifecycle)
    - [PENDING](#pending)
    - [ACTIVE](#active)
    - [SUPERSEDED](#superseded)
    - [CORRUPTED](#corrupted)
    - [RECALLED](#recalled)
    - [DELETED](#deleted)
    - [activated flag](#the-activated-flag--the-onoff-switch-for-device-visibility)
    - [Release types](#release-types--beta-vs-prod)
11. [Deployment Lifecycle](#deployment-lifecycle)
    - [Targeting modes](#creating-a-deployment--the-four-targeting-modes)
    - [AWAITING_CONSENT](#awaiting_consent)
    - [QUEUED](#queued)
    - [IN_PROGRESS](#in_progress)
    - [SUCCEEDED](#succeeded)
    - [FAILED](#failed)
    - [CANCELLED](#cancelled)
    - [Consent statuses](#consent-statuses--per-device-per-deployment)
    - [Rollback](#rollback--undoing-an-update)
12. [Consent-Gated OTA Flow — end-to-end example](#consent-gated-ota-flow--end-to-end-example)
13. [Audit Logging](#audit-logging)
14. [Branding & Customisation](#branding--customisation)

---

## Overview

The admin web interface allows operations and engineering teams to:

- Upload firmware binaries (single or multipart for files > 10 MB)
- Manage packages — publish, withdraw, or recall firmware versions
- Create consent-gated OTA deployments targeting individual devices (THING) or device groups (THING_GROUP)
- Monitor per-device consent status (Pending / Accepted / Declined / Expired) on the deployment detail page
- Roll back a deployment to a previously published version
- Abort in-progress deployments

**Consent-gated flow:** When a deployment is created, device owners receive a YES/NO notification in the Flutter app (via the `check_updates` API). The IoT Job is only created per-device when the owner accepts. Unanswered requests expire after a configurable number of days and the owner is notified by email.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 |
| Routing | React Router v6 |
| HTTP Client | Axios |
| Build Tool | Vite 5 |
| Auth | AWS Cognito (USER_PASSWORD_AUTH flow) |
| File Upload | Browser Fetch API (direct PUT to S3 pre-signed URLs) |

---

## Project Structure

```
src/
  api/
    client.js               Axios instance factory (attaches Bearer token)
  auth/
    AuthContext.jsx         Cognito login/logout, token stored in localStorage
    LoginPage.jsx           Login form
  components/
    Navbar.jsx              Top navigation bar
    ProgressBar.jsx         Upload progress indicator
    StatusBadge.jsx         Coloured status pill
  pages/
    UploadPage.jsx          Firmware upload (single + multipart)
    PackagesPage.jsx        Package list, publish/withdraw/recall
    DeploymentsPage.jsx     Deployment list + create form
    DeploymentDetailPage.jsx  Job detail, device progress, abort, rollback
  utils/
    logger.js               Structured console logger (DEBUG/INFO/WARN/ERROR)
    audit.js                In-memory user-action audit trail
  config.js                 All env-driven constants
  App.jsx                   Router root
  main.jsx                  React entry point
```

---

## Setup & Configuration

All runtime config is driven by environment variables. Copy `.env.example` (or create `.env.local`) and fill in the values:

```env
# Branding
VITE_BRAND_NAME=Digilux
VITE_APP_SUBTITLE=OTA Admin
VITE_LOGO_URL=https://your-cdn.com/logo.png

# Navigation labels (optional overrides)
VITE_NAV_UPLOAD=Upload
VITE_NAV_PACKAGES=Packages
VITE_NAV_DEPLOYMENTS=Deployments

# API
VITE_API_BASE=https://iot.digilux.co.in/smarthome/api/v1

# AWS Cognito
VITE_COGNITO_URL=https://cognito-idp.ap-south-1.amazonaws.com/
VITE_COGNITO_CLIENT=<your-app-client-id>

# Device types shown in the upload form (comma-separated)
VITE_DEVICE_TYPES=Network_controller_firmware,Network_controller_zigbee_firmware,Network_controller_Z2M_Firmware,Network_controller_Miscellaneous
```

**Defaults** (used when env vars are absent):

| Variable | Default |
|---|---|
| `VITE_API_BASE` | `https://iot.digilux.co.in/smarthome/api/v1` |
| `VITE_COGNITO_URL` | `https://cognito-idp.ap-south-1.amazonaws.com/` |
| `VITE_COGNITO_CLIENT` | `2qmig1uh220ttntbl0gfvcde4f` |
| `VITE_DEVICE_TYPES` | See above four types |

---

## Running Locally

```bash
npm install
npm run dev          # starts at http://localhost:5173
npm run build        # production build → dist/
npm run preview      # serve the production build locally
```

---

## Authentication

Login is handled directly against **AWS Cognito** using the `InitiateAuth` API — no backend proxy is involved for auth.

The returned **Cognito ID Token** (JWT) is:
- Stored in `localStorage` under key `ota_token`
- Attached to every backend API request as the `Authorization` header (plain token, not `Bearer <token>`)

Session persists across page refreshes until the user explicitly logs out.

---

## Pages & Features

### Upload (`/upload`)
- Select device type, version, and release notes (**mandatory**, 20–500 characters with live counter)
- Attach a firmware binary file — allowed extensions vary by device type (all types accept `.tar`)
- SHA-256 checksum is computed in-browser (Web Crypto API) before upload
- Files <= 10 MB: single PUT to S3
- Files > 10 MB: automatic multipart upload (10 MB chunks, 3 concurrent)
- Polls package status after upload until `ACTIVE` or `CORRUPTED`

### Packages (`/packages`)
- Lists all packages with filter by status and device type
- Sortable and inline-searchable columns
- Per-package actions: **Publish**, **Withdraw**, **Recall** (recall requires a reason)

### Deployments (`/deployments`)
- Lists all OTA deployment jobs; `AWAITING_CONSENT` rows are highlighted yellow
- Create a new deployment targeting a THING, THING_GROUP, or selected beta users
- Rollout stage: CANARY | BETA | PRODUCTION

### Deployment Detail (`/deployments/:jobId`)
- Job metadata, IoT Job ARN, status
- **Consent Stats card** (shown for consent-gated deployments) — Pending / Accepted / Declined / Expired counts
- Per-device progress table (shown once IoT Jobs have been created)
- **Abort** button — for `AWAITING_CONSENT` deployments this cancels all pending consent records; for active IoT Jobs it cancels the job
- **Rollback** button — automatically finds the nearest lower published version and creates a new deployment

---

## API Reference

**Base URL:** `https://iot.digilux.co.in/smarthome/api/v1`

All endpoints (except Cognito auth) require the Cognito ID Token passed as:

```
Authorization: <id_token>
```

---

### 1. Authentication (AWS Cognito)

The frontend calls AWS Cognito directly — this is **not** a backend endpoint.

**POST** `https://cognito-idp.ap-south-1.amazonaws.com/`

**Request Headers:**
```
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth
```

**Request Body:**
```json
{
  "AuthFlow": "USER_PASSWORD_AUTH",
  "ClientId": "<cognito_app_client_id>",
  "AuthParameters": {
    "USERNAME": "admin@example.com",
    "PASSWORD": "••••••••"
  }
}
```

**Success Response (200):**
```json
{
  "AuthenticationResult": {
    "IdToken": "<jwt>",
    "AccessToken": "<jwt>",
    "RefreshToken": "<jwt>",
    "ExpiresIn": 3600,
    "TokenType": "Bearer"
  }
}
```

**Error Response (400):**
```json
{
  "__type": "NotAuthorizedException",
  "message": "Incorrect username or password."
}
```

> The `IdToken` is used as the `Authorization` header for all subsequent API calls.

---

### 2. Initiate Upload

Registers a new firmware package and returns S3 pre-signed URL(s) for the binary upload.

**POST** `/ota/packages/upload-artefact`

**Request Body:**
```json
{
  "deviceType": "Network_controller_firmware",
  "version": "1.2.3",
  "releaseType": "PROD",
  "releaseNotes": "Optional release notes",
  "checksum": "a3f5c2d1e4b67890abcdef1234567890abcdef1234567890abcdef1234567890",
  "totalSize": 5242880
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `deviceType` | string | Yes | One of the configured device types |
| `version` | string | Yes | Semantic version string e.g. `1.2.3` |
| `releaseType` | string | Yes | `PROD` or `UAT` |
| `releaseNotes` | string | Yes | What changed in this version — min 20, max 500 characters |
| `checksum` | string | Yes | SHA-256 hex of the file (computed client-side) |
| `totalSize` | number | Yes | File size in bytes |

**Success Response — SINGLE upload (200):**

Returned when `totalSize` <= 10 MB (backend decides threshold).

```json
{
  "uploadType": "SINGLE",
  "packageName": "Network_controller_firmware-1.2.3",
  "version": "1.2.3",
  "uploadUrl": "https://s3.amazonaws.com/bucket/key?X-Amz-Signature=...",
  "uploadToken": "abc123uploadtoken"
}
```

After receiving this response, the client does a single `PUT` to `uploadUrl` with:
```
Content-Type: application/octet-stream
x-amz-meta-upload-token: <uploadToken>
```

**Success Response — MULTIPART upload (200):**

Returned when `totalSize` > 10 MB.

```json
{
  "uploadType": "MULTIPART",
  "packageName": "Network_controller_firmware-2.0.0",
  "version": "2.0.0",
  "uploadId": "VXBsb2FkSWQ...",
  "totalChunks": 4,
  "chunkSize": 10485760,
  "chunkUrls": [
    { "partNumber": 1, "url": "https://s3.amazonaws.com/...?partNumber=1&uploadId=..." },
    { "partNumber": 2, "url": "https://s3.amazonaws.com/...?partNumber=2&uploadId=..." },
    { "partNumber": 3, "url": "https://s3.amazonaws.com/...?partNumber=3&uploadId=..." },
    { "partNumber": 4, "url": "https://s3.amazonaws.com/...?partNumber=4&uploadId=..." }
  ]
}
```

Each chunk is uploaded via `PUT` to its respective `url` with `Content-Type: application/octet-stream`. The `ETag` from each response is collected for the complete call.

**Error Response (4xx/5xx):**
```json
{
  "error": "Version 1.2.3 already exists for this device type"
}
```

---

### 3. Complete Multipart Upload

Called after all chunk PUTs succeed, to finalise the S3 multipart upload.

**POST** `/ota/packages/upload-artefact/complete`

**Request Body:**
```json
{
  "packageName": "Network_controller_firmware-2.0.0",
  "version": "2.0.0",
  "parts": [
    { "partNumber": 1, "etag": "\"d8e8fca2dc0f896fd7cb4cb0031ba249\"" },
    { "partNumber": 2, "etag": "\"b026324c6904b2a9cb4b88d6d61c81d1\"" },
    { "partNumber": 3, "etag": "\"26ab0db90d72e28ad0ba1e22ee510510\"" },
    { "partNumber": 4, "etag": "\"6d7fce9fee471194aa8b5b6e47267f03\"" }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `packageName` | string | As returned by initiate upload |
| `version` | string | Firmware version |
| `parts` | array | Ordered list of `{ partNumber, etag }` from S3 PUT responses |

**Success Response (200):**
```json
{
  "message": "Multipart upload completed successfully"
}
```

**Error Response (4xx/5xx):**
```json
{
  "error": "Upload assembly failed — checksum mismatch"
}
```

---

### 4. List Packages

Returns a filtered list of firmware packages.

**GET** `/ota/packages`

**Query Parameters:**

| Param | Required | Description |
|---|---|---|
| `status` | No | Filter by status: `ACTIVE`, `PENDING`, `CORRUPTED`, `RECALLED` |
| `deviceType` | No | Filter by device type string |

**Example:**
```
GET /ota/packages?status=ACTIVE&deviceType=Network_controller_firmware
```

**Success Response (200):**
```json
{
  "packages": [
    {
      "packageName": "Network_controller_firmware-1.2.3",
      "version": "1.2.3",
      "deviceType": "Network_controller_firmware",
      "releaseType": "PROD",
      "releaseNotes": "Stability improvements",
      "status": "ACTIVE",
      "activated": true,
      "artifactSize": 5242880,
      "sha256": "a3f5c2d1e4b67890abcdef1234567890abcdef1234567890abcdef1234567890",
      "createdAt": 1700000000000
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `packageName` | string | Unique identifier, typically `<deviceType>-<version>` |
| `version` | string | Semantic version |
| `deviceType` | string | Target device type |
| `releaseType` | string | `PROD` or `UAT` |
| `releaseNotes` | string | Optional free-text |
| `status` | string | `PENDING` / `ACTIVE` / `CORRUPTED` / `RECALLED` |
| `activated` | boolean | Whether the package is published for device consumption |
| `artifactSize` | number | File size in bytes |
| `sha256` | string | SHA-256 hex of the binary |
| `createdAt` | number | Unix timestamp (ms) |

---

### 5. Get Package

Returns a single package by name and version. Used by the upload flow to poll processing status.

**GET** `/ota/packages/:packageName/:version`

**Example:**
```
GET /ota/packages/Network_controller_firmware-1.2.3/1.2.3
```

**Success Response (200):**
```json
{
  "packageName": "Network_controller_firmware-1.2.3",
  "version": "1.2.3",
  "deviceType": "Network_controller_firmware",
  "releaseType": "PROD",
  "status": "ACTIVE",
  "activated": false,
  "artifactSize": 5242880,
  "sha256": "a3f5c2d1e4b67890abcdef1234567890abcdef1234567890abcdef1234567890",
  "createdAt": 1700000000000
}
```

When status is `CORRUPTED`, an additional field is returned:

```json
{
  "status": "CORRUPTED",
  "corruptReason": "SHA-256 mismatch: expected abc... got def..."
}
```

**Error Response (404):**
```json
{
  "error": "Package not found"
}
```

---

### 6. Activate / Withdraw / Recall Package

Single endpoint that handles three distinct operations depending on the payload.

**PATCH** `/ota/packages/:packageName/:version/activate`

#### 6a. Publish (activate)

Makes the package available for device update checks.

**Request Body:**
```json
{
  "activated": true
}
```

**Success Response (200):**
```json
{
  "message": "Package published successfully"
}
```

#### 6b. Withdraw (deactivate)

Removes the package from device update checks without deleting it.

**Request Body:**
```json
{
  "activated": false
}
```

**Success Response (200):**
```json
{
  "message": "Package withdrawn successfully"
}
```

#### 6c. Recall

Permanently flags the package as recalled. Devices will no longer receive this version. Requires a mandatory reason.

**Request Body:**
```json
{
  "recalled": true,
  "recallReason": "Critical security vulnerability in v1.2.3"
}
```

**Success Response (200):**
```json
{
  "message": "Package recalled successfully"
}
```

**Error Response (4xx):**
```json
{
  "error": "Package is already recalled"
}
```

---

### 7. List Deployments

Returns all OTA deployment jobs.

**GET** `/ota/deployments`

**Success Response (200):**
```json
{
  "jobs": [
    {
      "jobId": "ota-job-1234abcd-5678-efgh-ijkl-mnopqrstuvwx",
      "packageName": "Network_controller_firmware-1.2.3",
      "version": "1.2.3",
      "targetType": "THING_GROUP",
      "targetId": "DGX-Production",
      "rolloutStage": "PRODUCTION",
      "status": "IN_PROGRESS",
      "createdAt": "2024-11-15T10:30:00.000Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `jobId` | string | Unique job identifier (AWS IoT Job ID) |
| `packageName` | string | Package being deployed |
| `version` | string | Package version |
| `targetType` | string | `THING` (single device) or `THING_GROUP` |
| `targetId` | string | Device Thing name or Thing Group name |
| `rolloutStage` | string | `CANARY`, `BETA`, or `PRODUCTION` |
| `status` | string | See [Deployment Lifecycle](#deployment-lifecycle) |
| `createdAt` | string | ISO 8601 timestamp |

---

### 8. Create Deployment

Creates a consent-gated OTA deployment. No IoT Job is created immediately — the deployment sits in `AWAITING_CONSENT` until each device owner responds via the Flutter app.

**POST** `/ota/deployments`

**Request Body — THING or THING_GROUP:**
```json
{
  "packageName": "HomeAssistantUtility",
  "version": "4.5.0",
  "targetType": "THING",
  "targetId": "edb39bba-baf1-4700-968c-a42228e53aa0",
  "rolloutStage": "PRODUCTION"
}
```

**Request Body — BETA (selected beta users):**
```json
{
  "packageName": "HomeAssistantUtility",
  "version": "4.5.0",
  "rolloutStage": "BETA",
  "targetIds": ["edb39bba-baf1-4700-968c-a42228e53aa0"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `packageName` | string | Yes | Must match an existing `ACTIVE` package |
| `version` | string | Yes | Must match the package version |
| `targetType` | string | THING/THING_GROUP | `THING` (single device UUID) or `THING_GROUP` (group name) |
| `targetId` | string | THING/THING_GROUP | Device UUID or IoT thing group name |
| `targetIds` | array | BETA/CUSTOM | Array of device UUIDs |
| `rolloutStage` | string | Yes | `BETA`, `CANARY`, `UAT`, or `PRODUCTION` |

**Success Response (201):**
```json
{
  "jobId": "digilux-ota-HomeAssistantUtility-4-5-0-1790072620",
  "packageName": "HomeAssistantUtility",
  "version": "4.5.0",
  "targetType": "THING",
  "targetId": "edb39bba-baf1-4700-968c-a42228e53aa0",
  "rolloutStage": "PRODUCTION",
  "status": "AWAITING_CONSENT",
  "consentCount": 1,
  "message": "Deployment created. Consent notifications sent to 1 device(s)."
}
```

**Error Response (4xx):**
```json
{
  "error": "Package HomeAssistantUtility@4.5.0 is not ACTIVE"
}
```

---

### 9. Get Deployment Detail

Returns full detail for a deployment job including per-device progress.

**GET** `/ota/deployments/:jobId`

**Example:**
```
GET /ota/deployments/ota-job-1234abcd-5678-efgh-ijkl-mnopqrstuvwx
```

**Success Response (200) — AWAITING_CONSENT deployment:**
```json
{
  "jobId": "digilux-ota-HomeAssistantUtility-4-5-0-1790072620",
  "packageName": "HomeAssistantUtility",
  "version": "4.5.0",
  "targetType": "THING",
  "targetId": "edb39bba-baf1-4700-968c-a42228e53aa0",
  "rolloutStage": "PRODUCTION",
  "status": "AWAITING_CONSENT",
  "consentCount": 1,
  "consentStats": {
    "PENDING": 1,
    "ACCEPTED": 0,
    "DECLINED": 0
  },
  "createdAt": 1790072620000,
  "createdBy": "admin@digilux.co.in"
}
```

**Success Response (200) — after user accepts (IoT Job created):**
```json
{
  "jobId": "digilux-ota-HomeAssistantUtility-4-5-0-1790072620",
  "status": "AWAITING_CONSENT",
  "consentStats": {
    "PENDING": 0,
    "ACCEPTED": 1,
    "DECLINED": 0
  },
  "deviceStatuses": {}
}
```

| Field | Type | Description |
|---|---|---|
| `consentCount` | number | Total devices a consent request was sent to |
| `consentStats` | object | Count of consents by status: PENDING / ACCEPTED / DECLINED |
| `iotJobArn` | string | Full AWS IoT Job ARN (present once at least one device has accepted) |
| `iotJobStatus` | string | Raw status from AWS IoT (may differ from `status` during transition) |
| `deviceStatuses` | object | Map of `thingName` → `{ status, lastUpdatedAt }` (populated after IoT Job runs) |

**Device status values:** `QUEUED`, `IN_PROGRESS`, `SUCCEEDED`, `FAILED`, `REJECTED`, `REMOVED`, `TIMED_OUT`

**Error Response (404):**
```json
{
  "error": "Job not found"
}
```

---

### 10. Abort Deployment

Cancels an in-progress deployment. Has no effect on devices that have already received the update.

**POST** `/ota/deployments/:jobId/abort`

**Request Body:** _(empty)_

**Success Response (200):**
```json
{
  "message": "Deployment aborted successfully"
}
```

**Error Response (400):**
```json
{
  "error": "Cannot abort a job in SUCCEEDED state"
}
```

---

### 11. Device — Check for Available Updates

Returns available OTA updates for all devices owned by the authenticated user.

> **Auth:** Requires a user-pool access token obtained via **OAuth 2.0 Authorization Code + PKCE** flow (not a plain `USER_PASSWORD_AUTH` token). The token must carry the `smarthome_server/read` scope.
>
> **Base URL:** `https://iot.digilux.co.in/api/v1` _(different from the admin base URL)_

**GET** `https://iot.digilux.co.in/api/v1/ota/device/available-updates`

**Request Headers:**
```
Authorization: Bearer <pkce_access_token>
```

**Success Response (200):**
```json
{
  "devices": [
    {
      "deviceId": "edb39bba-baf1-4700-968c-a42228e53aa0",
      "otaStatus": "REGISTERED",
      "package": "HomeAssistantUtility",
      "installedVersion": "1.0.0",
      "availableVersion": "4.5.0",
      "fileName": "HomeAssistantUtility-4.5.0.jar",
      "releaseNotes": "Fixed zigbee reconnect loop on cold boot"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `deviceId` | string | Device UUID |
| `otaStatus` | string | `REGISTERED` — OTA agent active; `NOT_REGISTERED` — agent not yet started |
| `package` | string | Package name the device is running |
| `installedVersion` | string | Currently installed version |
| `availableVersion` | string | Latest published version available for this device |
| `fileName` | string | Artifact filename |
| `releaseNotes` | string | Release notes for the available version |

When no updates are available, or the user has no registered devices, `devices` is an empty array.

---

### 12. User — Respond to Consent Request

Called by the Flutter app when the user taps YES or NO on an update notification.

> **Auth:** Same as §11 — Bearer PKCE access token.
>
> **Base URL:** `https://iot.digilux.co.in/api/v1`

**POST** `https://iot.digilux.co.in/api/v1/ota/my/updates/consent`

**Request Body — YES (accept):**
```json
{
  "deviceId": "edb39bba-baf1-4700-968c-a42228e53aa0",
  "packageName": "HomeAssistantUtility",
  "version": "4.5.0",
  "accepted": true
}
```

**Request Body — NO (decline):**
```json
{
  "deviceId": "edb39bba-baf1-4700-968c-a42228e53aa0",
  "packageName": "HomeAssistantUtility",
  "version": "4.5.0",
  "accepted": false
}
```

**Success Response — accepted (202):**
```json
{
  "jobId": "digilux-ota-HomeAssistantUtility-4-5-0-1790072916",
  "deviceId": "edb39bba-baf1-4700-968c-a42228e53aa0",
  "packageName": "HomeAssistantUtility",
  "version": "4.5.0",
  "status": "QUEUED",
  "message": "Update accepted. Your device will download and install the update shortly."
}
```

**Success Response — declined (200):**
```json
{
  "status": "DECLINED",
  "message": "Update declined. No firmware changes will be made to your device."
}
```

**Error Response (409) — already responded:**
```json
{
  "error": "You have already declined this update.",
  "status": "DECLINED"
}
```

**Error Response (410) — expired:**
```json
{
  "error": "This update consent request has expired."
}
```

> **Legacy mode (user-initiated):** The endpoint also supports the old body `{ "deviceId", "packageName", "version" }` for user-initiated updates where no admin deployment exists. The IoT Job is created immediately in this case.

---

## Upload Flow

This section explains every step that happens when you upload a firmware file — including what can go wrong and what each state means.

---

### What happens when you upload a file — step by step

#### Step 0 — Fill in the form

Before you choose a file you must fill in:

| Field | What it is | Rules |
|---|---|---|
| **Device Type** | Which kind of hardware this firmware is for | Pick from the dropdown — each type has its own allowed file extensions |
| **Version** | A version number you assign | Free text, e.g. `4.5.0` — must be unique per device type |
| **Release Notes** | A plain-English description of what changed | Mandatory, minimum 20 characters, maximum 500. A live counter shows how many characters you have left. The counter turns green once you have enough, and amber when you are close to the limit |

> **Why are release notes mandatory?** Device owners see release notes in the Flutter app when deciding whether to approve an update. Vague or empty notes lead to users declining updates, so the system enforces a meaningful description.

#### Step 1 — You pick a file and the browser hashes it immediately

The moment you select a file, before any network call is made, the browser:

1. Reads the entire file into memory
2. Computes a **SHA-256 fingerprint** (a 64-character hex string that uniquely represents the file's exact contents)
3. Displays the first 16 characters of the hash next to the file name so you can confirm the right file was picked
4. Shows a **SINGLE** or **MULTIPART** badge telling you which upload path will be used

> **Why hash in the browser?** The backend independently verifies the same hash after the binary lands in S3. If even one bit was corrupted in transit, the hashes will not match and the package ends up `CORRUPTED`. Computing the hash before upload gives the backend a ground-truth fingerprint to compare against.

**File validation also happens here.** If you pick:
- An empty file (0 bytes) → rejected immediately with an error
- A file with the wrong extension for the selected device type → rejected immediately

Allowed extensions per device type:

| Device Type | Allowed extensions |
|---|---|
| `Network_controller_firmware` | `.jar`, `.tar` |
| `Network_controller_Z2M_Firmware` | `.tar` |
| `Network_controller_zigbee_firmware` | `.bin`, `.tar` |
| `Network_controller_zigbee_stack_firmware` | `.bin`, `.tar` |
| `Network_controller_Miscellaneous` | `.db`, `.yml`, `.yaml`, `.cert`, `.prop`, `.tar` |

#### Step 2 — Initiate upload (backend registers the package)

When you click **Upload**, the frontend sends:

```
POST /ota/packages/upload-artefact
{
  "deviceType":   "Network_controller_firmware",
  "version":      "4.5.0",
  "releaseType":  "BETA",
  "releaseNotes": "Fixed zigbee reconnect loop on cold boot",
  "checksum":     "<sha256 computed in step 1>",
  "totalSize":    <file size in bytes>
}
```

The backend does three things immediately:
1. Creates a DynamoDB record for this package with status **`PENDING`**
2. Generates pre-signed S3 URL(s) that grant temporary write access directly to the S3 bucket
3. Returns the URL(s) to the browser

The package is now in `PENDING` — it exists in the database but the binary has not arrived yet.

**What can fail here:**
- Version already exists for this device type → `400 Version already exists`
- Missing required fields → `400 validation error`

#### Step 3 — Binary upload to S3 (directly from your browser)

The frontend uploads the file **directly to S3** using the pre-signed URL(s). The backend Lambda is not in the data path — this means large files don't put load on the Lambda, and upload speed is limited only by your internet connection and S3's throughput.

There are two paths depending on file size:

---

**Path A — SINGLE upload (file ≤ 10 MB)**

```
Browser ──PUT entire file──► S3 (via pre-signed URL)
```

One HTTP PUT with the full file body. The progress bar shows the single upload completing.

**What can fail here:** If S3 returns a non-2xx response the upload fails. The package stays `PENDING` in DynamoDB but the binary never arrived. Delete the package and re-upload.

---

**Path B — MULTIPART upload (file > 10 MB)**

The backend splits the upload into 10 MB chunks and issues a pre-signed URL for each one.

```
         ┌── PUT chunk 1 ──┐
Browser ─┼── PUT chunk 2 ──┼─ (3 chunks in parallel) ──► S3
         └── PUT chunk 3 ──┘
                  then
         ┌── PUT chunk 4 ──┐
         └── PUT chunk 5 ──┘  (next batch of up to 3)  ──► S3
                  ...
POST /ota/packages/upload-artefact/complete
     { parts: [{partNumber, etag}, ...] }   ──► S3 reassembles all chunks
```

The browser uploads 3 chunks at a time in parallel. As each chunk completes, the progress bar advances. After all chunks are done, the browser calls the **complete** endpoint to tell S3 to stitch all chunks into one object.

**What can fail here:**
- Any individual chunk fails → the whole upload stops with an error. The S3 multipart upload is left incomplete (S3 will garbage-collect it). Restart the upload.
- The complete call fails → chunks are uploaded but not assembled. Package stays `PENDING`. Restart the upload.

#### Step 4 — Backend processes the binary (artifact_processor Lambda)

After the binary lands in S3, an S3 event automatically triggers the **artifact_processor** Lambda. You don't do anything — the UI enters a "Processing…" state and polls until done.

The artifact_processor does all of the following:

1. **Verifies the SHA-256 checksum** — recomputes the hash of the file in S3 and compares it to the hash submitted in Step 2. If they don't match, the package is marked `CORRUPTED`.
2. **Generates an ECDSA digital signature** — signs the binary so the device can verify the firmware is authentically from Digilux before applying it.
3. **Encrypts the binary with AES-256-GCM** — generates a unique random encryption key for this package, encrypts the binary, then calls the Digilux Key Server to wrap (encrypt) that key for safe storage. The plain key never sits in AWS — only the wrapped version is stored in DynamoDB.
4. **Stores artifacts under opaque S3 keys** — the encrypted binary and signature are stored as `enc/<uuid>.enc` and `sig/<uuid>.sig` so no package information is visible in pre-signed download URLs.
5. **Updates the DynamoDB record** to `ACTIVE` (success) or `CORRUPTED` (failure).

The UI polls `GET /ota/packages/:packageName/:version` every 2 seconds for up to 60 seconds.

**What can fail here:**
- **`CORRUPTED`** — SHA-256 mismatch. The file was corrupted in transit. You must delete the package and re-upload the correct file.
- **Polling timeout** — The Lambda took longer than 60 seconds (very rare). Reload the Packages page — the package may have finished processing in the background.

#### Complete upload flow diagram

```
Fill in form (deviceType, version, releaseNotes)
              │
              ▼
Select file ──► validate extension & zero-byte check ──► SHA-256 computed in browser
              │
              ▼
POST /upload-artefact  ──► DynamoDB: package status = PENDING
              │
              ├─ [file <= 10 MB]  PUT entire file ─────────────────────────► S3
              │
              └─ [file > 10 MB]   PUT chunks (3 at a time) ────────────────► S3
                                  POST /complete ─────────────────────────► S3 assembles
              │
              ▼  (S3 event fires automatically)
    artifact_processor Lambda
              │
              ├── verify SHA-256
              ├── sign with ECDSA
              ├── encrypt with AES-256-GCM
              ├── store as opaque UUID keys in S3
              └── update DynamoDB
              │
              ├─ [OK]   ──► status = ACTIVE     ◄── UI polling picks this up
              └─ [FAIL] ──► status = CORRUPTED  ◄── UI polling picks this up
```

---

## Package Lifecycle

A **package** is a versioned firmware binary for a specific device type. Every package passes through several states during its lifetime. Understanding these states is critical to knowing whether a package will actually reach devices.

---

### The two dimensions of a package

A package has **two independent attributes** that together determine whether devices will receive it:

| Attribute | Values | What it controls |
|---|---|---|
| `status` | `PENDING`, `ACTIVE`, `SUPERSEDED`, `CORRUPTED`, `RECALLED`, `DELETED` | Whether the binary is valid and what lifecycle stage it is in |
| `activated` | `true` / `false` | Whether this package is currently offered to devices when they check for updates |

A package must have **`status = ACTIVE`** AND **`activated = true`** before any device will see it as an available update. Both conditions must be true at the same time.

---

### Every package status — explained

#### `PENDING`

**What it means:** The firmware file has been registered in the database and the binary is being uploaded to (or has just arrived in) S3. The `artifact_processor` Lambda has not finished verifying it yet.

**How a package enters this state:** Automatically, the moment you click Upload and the backend creates the database record — before any byte of the file has reached S3.

**How long it stays here:** Usually 5–30 seconds, depending on file size.

**What you can do:** Nothing — wait for processing to finish. The Upload page polls automatically and shows "Processing…".

**What happens next:** The package moves to either `ACTIVE` (success) or `CORRUPTED` (failure). There is no way to get stuck permanently in `PENDING`.

---

#### `ACTIVE`

**What it means:** The binary has been uploaded successfully, the checksum was verified, it has been encrypted and signed, and it is ready to be deployed to devices.

**How a package enters this state:** Automatically when `artifact_processor` finishes verifying the binary with no errors.

**Important:** `ACTIVE` alone does not mean devices will see the update. The package also needs `activated = true` (published). By default, a newly processed package has `activated = false` — you must explicitly publish it.

**Think of it like a product on a warehouse shelf.** The product exists (`ACTIVE`) but is not yet on the shop floor. Publishing (`activated = true`) is moving it from the warehouse to the shelf where customers can see it.

**What you can do on an ACTIVE package:**

| Button | What it does | Result |
|---|---|---|
| **Publish** | Sets `activated = true` | Devices start seeing this as an available update on their next check |
| **Withdraw** | Sets `activated = false` | Devices stop seeing this update — use when you need to pause distribution without permanently removing the package (e.g. you discovered a bug and want to investigate before proceeding) |
| **→ PROD** | Promotes the package from BETA/UAT to PROD (permanent, cannot be reversed) | Use when beta testing is complete and you want all production devices eligible for this update |
| **Recall** | Permanently flags the package as `RECALLED` and requires a written reason | Emergency use — critical bug or security vulnerability discovered after release |

**Row colours on the Packages page:**
- **Green row** = ACTIVE + `activated = true` (currently being offered to devices)
- **No colour** = ACTIVE + `activated = false` (exists but not yet published)
- **Amber row** = ACTIVE + BETA/UAT + `activated = true` (being offered, but only to beta devices)

---

#### `SUPERSEDED`

**What it means:** A newer version of the same package has become `ACTIVE`, and this older version has been automatically retired. The system ensures only one version of a package is `ACTIVE` at any given time.

**How a package enters this state:** Automatically when a newer version of the same package and device type finishes processing and becomes `ACTIVE`.

**Example:** You have `HomeAssistantUtility v4.5.0` as ACTIVE. You upload `v4.6.0`. When v4.6.0 becomes ACTIVE, v4.5.0 automatically becomes SUPERSEDED. No manual action needed.

**What you can do on a SUPERSEDED package:**

| Button | What it does | When to use it |
|---|---|---|
| **↩ Restore** | Brings this version back to ACTIVE (the currently ACTIVE version becomes SUPERSEDED in its place) | Emergency rollback — v4.6.0 turned out to be buggy so you want to fall back to v4.5.0 |
| **🗑 Delete** | Permanently deletes the record and the S3 artifact | Routine cleanup after you are confident the old version is no longer needed |

> **Cooling-off period:** If a package was superseded recently (within the last 7 days), the system warns you before deletion because offline devices may still need to download it. You can override this warning by ticking "I understand — force delete anyway".

---

#### `CORRUPTED`

**What it means:** The `artifact_processor` Lambda recomputed the SHA-256 hash of the uploaded file and it did not match the hash submitted during the initiate call. The binary cannot be trusted and will never be distributed to devices.

**How a package enters this state:** Automatically when `artifact_processor` detects a hash mismatch. This can happen if:
- The file was corrupted during upload (a rare network error that S3 or the browser did not detect)
- You accidentally uploaded the wrong file
- There was a very rare S3 storage error

**What you can do:** Delete this package and re-upload the correct file. You cannot publish, recall, or deploy a CORRUPTED package — the system blocks all such actions.

When you fetch a CORRUPTED package via the API, a `corruptReason` field explains what was expected versus what was found.

---

#### `RECALLED`

**What it means:** An admin explicitly recalled this package, typically because of a critical bug or security vulnerability discovered after the package was already distributed to some devices.

**How a package enters this state:** Only manually — an admin clicks **Recall**, confirms the action in the dialog, and types a mandatory reason. This is **permanent and irreversible**.

**What happens automatically when you recall:**
1. The package is removed from all device update checks immediately (devices will no longer see this version as an available update)
2. All deployments targeting this package that are in `AWAITING_CONSENT` or `QUEUED` state are **automatically cancelled**
3. Any deployments already `IN_PROGRESS` are flagged with a warning on screen — you must abort those manually (the system cannot stop a download already in progress on a physical device)
4. An audit record is created with the actor's identity and the reason

**What you can still do:** Delete the package to remove the S3 artifact. Even after deletion, the audit record of the recall is retained permanently for forensic purposes.

---

#### `DELETED`

**What it means:** The package has been permanently removed — both the DynamoDB record and the encrypted binary in S3 are gone.

**How a package enters this state:** Only manually — an admin clicks **🗑 Delete**, which opens a confirmation modal requiring:
1. A free-text reason (mandatory)
2. Typing the exact version number to confirm (prevents accidental deletion)
3. For recently-superseded packages: checking an additional "I understand — force delete anyway" box

**Restrictions:** You cannot delete a package that is currently `ACTIVE`. You must first Withdraw or Recall it, then delete it.

**What you can see:** Deleted packages are hidden from all lists and filters in the UI. They do not appear on the Packages page.

---

### Package state diagram

```
You click Upload
        │
        ▼
    PENDING ─────────────── artifact_processor running ───────────────────
        │
        ├── [checksum OK] ──► ACTIVE  (activated = false by default)
        │                        │
        │                        ├── [Publish]    ──► activated = true
        │                        │                    devices see update
        │                        │
        │                        ├── [Withdraw]   ──► activated = false
        │                        │                    devices stop seeing update
        │                        │
        │                        ├── [→ PROD]     ──► releaseType = PROD
        │                        │                    permanent, cannot revert to BETA
        │                        │
        │                        ├── [newer version uploaded & processed]
        │                        │        └──► SUPERSEDED
        │                        │                 │
        │                        │                 ├── [↩ Restore] ──► ACTIVE
        │                        │                 └── [🗑 Delete]  ──► DELETED
        │                        │
        │                        └── [Recall] ──► RECALLED
        │                                             └── [🗑 Delete] ──► DELETED
        │
        └── [checksum FAIL] ──► CORRUPTED
                                    └── [🗑 Delete] ──► DELETED
```

---

### The `activated` flag — the on/off switch for device visibility

Being `ACTIVE` is a prerequisite, but the `activated` flag is what actually controls whether devices are offered the update. Think of it as a light switch: the electricity (`ACTIVE` status) has to be present, but the light only turns on when you flip the switch (`activated = true`).

| `status` | `activated` | What devices see |
|---|---|---|
| `ACTIVE` | `false` | Nothing — update exists but is not offered |
| `ACTIVE` | `true` | Update is offered at next check |
| `SUPERSEDED` | either | Nothing — superseded packages are never offered |
| `CORRUPTED` | either | Nothing — corrupt packages are never offered |
| `RECALLED` | either | Nothing — recalled packages are never offered |

---

### Release types — BETA vs PROD

Every package has a `releaseType` set at upload time:

| `releaseType` | Who can see the update | Typical use |
|---|---|---|
| `BETA` / `UAT` | Only devices in the `DGX-Canary` IoT Thing Group | Internal testing, QA, trusted beta testers |
| `PROD` | All eligible devices (regardless of group) | General availability |

When beta testing is complete and you are confident the build is stable, click **→ PROD** on the package. This promotion is **permanent** — a PROD package cannot be downgraded back to BETA.

---

## Deployment Lifecycle

A **deployment** is the act of pushing a specific firmware version to one or more devices. Every deployment goes through a consent gate before any firmware is actually sent to a device.

---

### Why is there a consent gate?

Digilux devices are installed in people's homes and businesses. A firmware update can restart or temporarily interrupt connected devices such as lights, locks, and sensors. The consent gate ensures:

- Device owners are informed about what the update contains (via release notes)
- They can choose the timing — they can decline if the moment is inconvenient
- No firmware is silently pushed to someone's home without their knowledge

---

### Creating a deployment — the four targeting modes

On the Deployments page, click **+ New Deployment**, then choose a package + version, a rollout stage, and the target(s):

---

#### Mode 1: PRODUCTION — single known device

Used when you want to update exactly one specific device by its UUID.

- Set **Rollout Stage** to `PRODUCTION`
- Enter the **Device ID** (the UUID of the device, e.g. `edb39bba-baf1-4700-968c-a42228e53aa0`)
- One consent request is sent to that device owner's Flutter app

**Example use case:** A specific customer reported an issue that was fixed in v4.6.0. You deploy only to their device to verify the fix in the field before rolling out more broadly.

---

#### Mode 2: BETA — your pre-registered beta user list

Used for controlled testing with a group of trusted testers who have opted in as beta users.

- Set **Rollout Stage** to `BETA`
- A checklist of all registered beta users appears — all are pre-selected; deselect any you want to exclude
- If a beta user has multiple devices, a small dropdown lets you choose which device per user
- One consent request is sent per selected user/device combination

**Example use case:** You have 5 employees who have agreed to test new builds. They are registered as beta users. You deploy v4.6.0-RC1 to all of them at once to catch issues before general release.

---

#### Mode 3: CUSTOM — an ad-hoc list of device IDs

Used when you have a specific set of device IDs that do not fit the beta user list.

- Set **Rollout Stage** to `CUSTOM`
- Paste or type device IDs one at a time (press Enter or click Add after each one); remove any with the ✕ button
- One consent request is sent per device

**Example use case:** A batch of 20 devices from a specific production run have a known hardware variant that requires a special firmware build. You paste their device IDs from a spreadsheet.

---

#### Mode 4: CANARY — an IoT Thing Group

Used for staged rollouts to a named group of devices defined in AWS IoT.

- Set **Rollout Stage** to `CANARY`
- Enter the **IoT Thing Group name** (e.g. `DGX-Canary`, `DGX-SiteA`)
- All devices currently in that Thing Group receive consent requests

**Example use case:** You have an IoT Thing Group called `DGX-Canary` containing 5% of your production fleet. You deploy to this group first to catch problems at small scale before rolling out to everyone.

---

### Every deployment status — explained in detail

#### `AWAITING_CONSENT`

**What it means:** The deployment record has been created and consent notifications have been sent to all target devices. No firmware has moved anywhere. The system is waiting for each device owner to respond in the Flutter app.

**How a deployment enters this state:** Automatically when you click **Create Deployment**. This is always the very first state — there is no way to skip consent.

**What the device owner sees:** The next time they open the Flutter app and the app calls `check_updates`, the response includes the available version and release notes. The app shows a notification prompting them to Accept or Decline.

**What you see in the Admin UI:**
- The deployment row is **highlighted yellow** on the Deployments list
- The Deployment Detail page shows a **User Consent** card with live counts: Pending / Accepted / Declined
- **Abort** button is available

**What you can do:** Abort (cancels all PENDING consent records and moves the deployment to `CANCELLED`). You cannot force-approve on behalf of users.

---

#### `QUEUED`

**What it means:** At least one device owner has tapped **YES** in the Flutter app. An AWS IoT Job has been created for that specific device and the device has been notified. The device has not yet started downloading or installing.

**How a deployment enters this state:** When the `user_consent` Lambda processes an `accepted: true` response. The Lambda at that moment:
1. Calls the Digilux Key Server to unwrap the AES encryption key for this package
2. Creates an AWS IoT Job with a document containing the presigned download URL and the decrypted AES key
3. Marks the consent record as `ACCEPTED`
4. Records the new IoT Job ID on the device's database record

**What you see in the Admin UI:** The Device Progress table appears on the detail page showing this device as `QUEUED`. The overall deployment status may still show `AWAITING_CONSENT` if other devices haven't yet responded.

**What you can do:** Abort (cancels the IoT Job before the device starts).

---

#### `IN_PROGRESS`

**What it means:** The device has acknowledged the IoT Job and its OTA agent is actively executing the update: downloading the encrypted binary, verifying the ECDSA signature, decrypting using the AES key from the job document, and writing the new firmware.

**How a deployment enters this state:** The device's OTA agent picks up the job from AWS IoT and sets its execution status to `IN_PROGRESS`. The `status_handler` Lambda receives the IoT status change event and syncs it to DynamoDB.

**What you see in the Admin UI:** Row highlighted blue. Device Progress shows `IN_PROGRESS`.

**What you can do:** Abort is still available, but use with extreme caution — aborting a job on a device that is mid-flash could leave the firmware in an inconsistent state.

---

#### `SUCCEEDED`

**What it means:** The device successfully downloaded, verified, decrypted, and installed the firmware. The device's OTA agent reported success back to AWS IoT, and the `status_handler` Lambda synced this back to DynamoDB and updated the device's recorded installed version.

**How a deployment enters this state:** Device agent calls back to AWS IoT with SUCCESS → IoT event fires → `status_handler` Lambda → DynamoDB updated.

**What you see in the Admin UI:** Row highlighted green. The **↩ Rollback** button appears. The **Abort** button disappears (no longer needed — the job is done).

**What you can do:** Rollback if you need to revert to an earlier version. SUCCEEDED is a terminal state — the deployment itself cannot be changed.

---

#### `FAILED`

**What it means:** The device attempted the update but reported failure. Possible causes: download error, signature verification failure (binary was tampered with in transit), decryption error, write error, or insufficient storage space on the device.

**How a deployment enters this state:** Device agent reports FAILED to IoT → `status_handler` Lambda → DynamoDB updated.

**What you see in the Admin UI:**
- Row highlighted red
- A yellow warning banner on the Deployment Detail page explaining that the failed job does not block future updates
- The **↩ Rollback** button appears

**Critical behaviour — a failed job does NOT permanently block the device:**
The `check_updates` Lambda detects stale failed jobs and clears them automatically. The next time the device checks for updates, it will see the latest available firmware just as if the failed job never happened.

The API response to the device also includes a `lastFailedJob` block so the Flutter app can inform the user:

```json
{
  "otaStatus": "REGISTERED",
  "availableVersion": "4.6.0",
  "lastFailedJob": {
    "jobId": "digilux-ota-HomeAssistantUtility-4-5-0-...",
    "status": "FAILED",
    "version": "4.5.0",
    "message": "A previous update attempt failed. Please try again or contact support."
  }
}
```

**What you can do:**
- **↩ Rollback** — create a new deployment targeting the same device(s) with the last confirmed-working version
- **+ New Deployment** — deploy a newer fixed version

FAILED is a terminal state — you cannot resume or retry the same deployment.

---

#### `CANCELLED`

**What it means:** An admin stopped the deployment before it reached a terminal state (SUCCEEDED or FAILED).

**How a deployment enters this state:** When you click **Abort**. What exactly happens depends on the deployment's state at the time:

| State when Abort is clicked | What happens |
|---|---|
| `AWAITING_CONSENT` | All `PENDING` consent records are set to `CANCELLED`. No IoT Jobs existed to cancel. Devices will no longer see the update notification. |
| `QUEUED` | The IoT Job is cancelled via the AWS IoT API before the device starts any work. |
| `IN_PROGRESS` | A cancellation request is sent to AWS IoT. The device's OTA agent may or may not honour it depending on how far the install has progressed. This is a best-effort cancellation. |

**What you can do:** Nothing — `CANCELLED` is a terminal state. Create a new deployment if you want to try again.

---

### Complete deployment state diagram

```
Admin clicks "Create Deployment"
              │
              ▼
   AWAITING_CONSENT ─────────────────────[Admin clicks Abort]──► CANCELLED
              │
        for each device owner independently:
              │
              ├── [User taps NO]
              │       └── consent = DECLINED
              │           SES email sent to user
              │           No IoT Job created for this device
              │
              └── [User taps YES]
                      └── consent = ACCEPTED
                          IoT Job created (includes download URL + AES key)
                          │
                          ▼
                       QUEUED ────────────[Admin clicks Abort]──► CANCELLED
                          │
                          │  Device OTA agent picks up job
                          ▼
                    IN_PROGRESS ──────────[Admin clicks Abort]──► CANCELLED (risky)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
          SUCCEEDED                FAILED
         (terminal)              (terminal)
       Rollback available      Rollback available
                               Next check-updates auto-clears stale job
```

---

### Consent statuses — per device, per deployment

Each consent record tracks one device owner's response to one specific deployment:

| Consent Status | Who sets it | What it means |
|---|---|---|
| `PENDING` | Set automatically when the deployment is created | The device owner has been notified but has not responded yet |
| `ACCEPTED` | Set when the user taps YES in the Flutter app | An IoT Job has been created for this device |
| `DECLINED` | Set when the user taps NO in the Flutter app | No IoT Job is created; an SES email is sent to confirm the declination |
| `CANCELLED` | Set when the admin aborts the deployment | The admin stopped the deployment before the user could respond |

The **User Consent card** on the Deployment Detail page shows live counts of all four statuses so you can see at a glance how many device owners have responded and how.

---

### Rollback — undoing an update

The **↩ Rollback** button is available on any `SUCCEEDED` or `FAILED` deployment. It automatically determines the best version to roll back to and creates a new deployment — you do not need to know the exact version number.

**How the rollback version is chosen:**

1. **First choice:** Look at deployment history and find the most recent `SUCCEEDED` deployment for the same package + same target device, with a different version than the current one. This was the last version confirmed as working on that device.
2. **Fallback:** If no previous SUCCEEDED deployment exists (this is the device's first deployment ever), find the highest published (`ACTIVE` + `activated = true`) version of the same package that is different from the current one.
3. **If neither exists:** An error message tells you to upload and publish an earlier version before retrying.

**What happens after you confirm the rollback:**

A brand new deployment is created and goes through the full consent-gated flow. The device owner will see a new consent notification in the Flutter app asking them to approve installing the older version. This is intentional — even a rollback should be explicitly approved by the device owner.

**If the target rollback version is `SUPERSEDED`:**

The system checks that the chosen version is still `ACTIVE`. If it has been superseded, you will see:

> *"v4.4.0 is currently SUPERSEDED and cannot be deployed. Go to Packages → restore v4.4.0 to ACTIVE first, then retry the rollback."*

In this case, go to the Packages page, find v4.4.0, and click **↩ Restore** to bring it back to ACTIVE. Then retry the rollback from the Deployment Detail page.

---

## Consent-Gated OTA Flow — end-to-end example

Here is a complete walkthrough from uploading new firmware all the way to a device successfully installing it.

```
Day 1 — Admin uploads firmware
─────────────────────────────
1. Admin uploads HomeAssistantUtility v4.6.0
   └── Package enters PENDING
   └── artifact_processor verifies, encrypts, signs
   └── Package enters ACTIVE (activated = false)

2. Admin goes to Packages → clicks Publish on v4.6.0
   └── activated = true
   └── Devices are now eligible to see this version on their next check

Day 2 — Admin creates a deployment
───────────────────────────────────
3. Admin goes to Deployments → clicks + New Deployment
   Selects: HomeAssistantUtility v4.6.0 / PRODUCTION / Device UUID

4. Backend creates deployment:  status = AWAITING_CONSENT
   Backend creates consent record for device:  consent = PENDING
   Admin sees: yellow row on Deployments list
   Consent card shows: Pending=1, Accepted=0, Declined=0

Day 2 — Device owner on their phone
─────────────────────────────────────
5. Device owner opens Flutter app
   App calls GET /ota/device/available-updates
   Response includes availableVersion: "4.6.0" and release notes

6. App shows: "Firmware update available — tap to review"
   Owner reads the release notes → taps YES

7. Backend receives: POST /ota/my/updates/consent { accepted: true }
   ├── Key Server called: unwrap AES key for v4.6.0
   ├── IoT Job created with download URL + decrypted AES key in job document
   ├── Consent record updated: ACCEPTED
   └── Device record updated with new pendingJobId

Day 2 — Device installs the firmware
──────────────────────────────────────
8. Device OTA agent polls AWS IoT → finds the new job
   Sets execution status: IN_PROGRESS
   Downloads encrypted binary from S3
   Verifies ECDSA signature (proves binary is from Digilux)
   Decrypts binary using AES key from job document
   Writes new firmware to flash
   Reports SUCCESS to IoT

9. status_handler Lambda fires on IoT event:
   └── Deployment record:  status = SUCCEEDED
   └── Device record:  installedVersion = 4.6.0

Admin sees on Deployments page:
────────────────────────────────
Green row, status SUCCEEDED
Consent card: Accepted=1, Pending=0, Declined=0
Device Progress table: SUCCEEDED for the device
↩ Rollback button now available
```

---

### What if the device owner declines?

```
Step 6 (alternate) — Owner taps NO
───────────────────────────────────
Backend receives: POST /ota/my/updates/consent { accepted: false }
├── Consent record: DECLINED
├── SES email sent to user: "Your update request was declined"
├── No IoT Job created
└── No change to device firmware

Admin sees:
Consent card: Declined=1
Deployment status remains AWAITING_CONSENT
  (if other devices still have PENDING consent)
```

To try again, the admin must create a new deployment — the existing one cannot be reused.

---

### What if the admin needs to cancel a deployment?

```
Clicking Abort on the Deployment Detail page:

If AWAITING_CONSENT ──► All PENDING consent records → CANCELLED
                        Deployment status → CANCELLED
                        Device owners who had not yet responded
                        will no longer see the notification

If QUEUED ──────────► IoT Job cancelled via AWS IoT API
                       Deployment status → CANCELLED
                       Device will not start the download

If IN_PROGRESS ─────► IoT Job cancellation request sent to AWS IoT
                       ⚠ Device may already be mid-install
                         Cancellation is best-effort only
                       Deployment status → CANCELLED
```

---

### User-initiated updates — no admin deployment needed

There is also a mode where a device owner can trigger an update from the Flutter app without waiting for an admin to create a deployment first. This is useful when the admin has published a new version and wants all owners to update at their own convenience.

**How it works:**

1. Device calls `check_updates` → sees `availableVersion: "4.6.0"`
2. Owner taps "Update Now" in the app
3. App calls `POST /ota/my/updates/consent` with `accepted: true`
4. Backend checks: no admin-created pending consent for this device/version
5. Backend takes the user-initiated path: creates the IoT Job immediately
6. Device proceeds with the update exactly as in the admin-initiated flow

**The difference from admin-initiated flow:** There is no `AWAITING_CONSENT` deployment record. The IoT Job is created immediately on the first `accepted: true` call. No consent stats card appears on any deployment detail page for these jobs.

---

---

## Audit Logging

Every user action is recorded in an in-memory audit trail (up to 1,000 entries) and emitted through the structured logger.

**Actions logged:**

| Action | Trigger |
|---|---|
| `LOGIN` | Successful / failed login |
| `LOGOUT` | User logs out |
| `UPLOAD_INITIATED` | Upload session created |
| `UPLOAD_COMPLETE` | Upload polling finished (success or failure) |
| `PACKAGE_PUBLISH` | Package activated |
| `PACKAGE_WITHDRAW` | Package deactivated |
| `PACKAGE_RECALL` | Package recalled |
| `DEPLOYMENT_CREATE` | New deployment created |
| `DEPLOYMENT_VIEW` | Deployment detail page opened |
| `DEPLOYMENT_ABORT` | Deployment aborted |
| `DEPLOYMENT_ROLLBACK` | Rollback deployment created |

**Audit entry shape:**
```json
{
  "ts": "2024-11-15T10:30:00.000Z",
  "actor": "admin@digilux.com",
  "action": "PACKAGE_RECALL",
  "resource": { "packageName": "...", "version": "1.2.3" },
  "result": "SUCCESS",
  "reason": "Critical security vulnerability"
}
```

In development, the full audit log is accessible in the browser console:
```js
window.__AUDIT_LOG__()    // returns array of all entries
window.__AUDIT_CLEAR__()  // clears the log
```

---

## Branding & Customisation

The UI is fully white-label configurable via environment variables:

| Variable | Purpose |
|---|---|
| `VITE_BRAND_NAME` | Company name shown in the navbar and login page |
| `VITE_APP_SUBTITLE` | Subtitle shown below the brand name on login |
| `VITE_LOGO_URL` | URL to a logo image (displayed on the login page) |
| `VITE_NAV_UPLOAD` | Label for the Upload nav item |
| `VITE_NAV_PACKAGES` | Label for the Packages nav item |
| `VITE_NAV_DEPLOYMENTS` | Label for the Deployments nav item |
| `VITE_DEVICE_TYPES` | Comma-separated list of device types in the upload form |

No code changes are required to rebrand the application — update the environment variables and rebuild.
