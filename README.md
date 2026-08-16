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
9. [Upload Flow](#upload-flow)
10. [Package Lifecycle](#package-lifecycle)
11. [Deployment Lifecycle](#deployment-lifecycle)
12. [Audit Logging](#audit-logging)
13. [Branding & Customisation](#branding--customisation)

---

## Overview

The admin web interface allows operations and engineering teams to:

- Upload firmware binaries (single or multipart for files > 10 MB)
- Manage packages — publish, withdraw, or recall firmware versions
- Create and monitor OTA deployment jobs targeting individual devices (THING) or device groups (THING_GROUP)
- Roll back a deployment to a previously published version
- Abort in-progress deployments

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
- Select device type, version, release type (PROD/UAT), and optional release notes
- Attach a firmware binary file
- SHA-256 checksum is computed in-browser (Web Crypto API) before upload
- Files <= 10 MB: single PUT to S3
- Files > 10 MB: automatic multipart upload (10 MB chunks, 3 concurrent)
- Polls package status after upload until `ACTIVE` or `CORRUPTED`

### Packages (`/packages`)
- Lists all packages with filter by status and device type
- Sortable and inline-searchable columns
- Per-package actions: **Publish**, **Withdraw**, **Recall** (recall requires a reason)

### Deployments (`/deployments`)
- Lists all OTA deployment jobs
- Create a new deployment targeting a THING or THING_GROUP
- Rollout stage: CANARY | BETA | PRODUCTION

### Deployment Detail (`/deployments/:jobId`)
- Job metadata, IoT Job ARN, status
- Per-device progress table
- **Abort** button (for non-terminal jobs)
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
| `releaseNotes` | string | No | Free-text notes |
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

Creates a new AWS IoT OTA deployment job.

**POST** `/ota/deployments`

**Request Body:**
```json
{
  "packageName": "Network_controller_firmware-1.2.3",
  "version": "1.2.3",
  "targetType": "THING_GROUP",
  "targetId": "DGX-Production",
  "rolloutStage": "PRODUCTION"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `packageName` | string | Yes | Must match an existing `ACTIVE` package |
| `version` | string | Yes | Must match the package version |
| `targetType` | string | Yes | `THING` or `THING_GROUP` |
| `targetId` | string | Yes | AWS IoT Thing name (for THING) or Thing Group name (for THING_GROUP) |
| `rolloutStage` | string | Yes | `CANARY`, `BETA`, or `PRODUCTION` |

**Success Response (200):**
```json
{
  "jobId": "ota-job-1234abcd-5678-efgh-ijkl-mnopqrstuvwx",
  "message": "Deployment created successfully"
}
```

**Error Response (4xx):**
```json
{
  "error": "Package is not published (activated = false)"
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

**Success Response (200):**
```json
{
  "jobId": "ota-job-1234abcd-5678-efgh-ijkl-mnopqrstuvwx",
  "packageName": "Network_controller_firmware-1.2.3",
  "version": "1.2.3",
  "targetType": "THING_GROUP",
  "targetId": "DGX-Production",
  "rolloutStage": "PRODUCTION",
  "status": "IN_PROGRESS",
  "iotJobStatus": "IN_PROGRESS",
  "iotJobArn": "arn:aws:iot:ap-south-1:123456789:job/ota-job-1234abcd",
  "createdAt": "2024-11-15T10:30:00.000Z",
  "deviceStatuses": {
    "device-thing-001": {
      "status": "IN_PROGRESS",
      "lastUpdatedAt": "2024-11-15T10:32:10.000Z"
    },
    "device-thing-002": {
      "status": "SUCCEEDED",
      "lastUpdatedAt": "2024-11-15T10:35:00.000Z"
    },
    "device-thing-003": {
      "status": "QUEUED",
      "lastUpdatedAt": "2024-11-15T10:30:05.000Z"
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `iotJobArn` | string | Full AWS IoT Job ARN |
| `iotJobStatus` | string | Raw status from AWS IoT (may differ from `status` during transition) |
| `deviceStatuses` | object | Map of `thingName` → `{ status, lastUpdatedAt }` |

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

## Upload Flow

```
User selects file
       |
       v
Browser computes SHA-256 (Web Crypto API)
       |
       v
POST /ota/packages/upload-artefact
  { deviceType, version, releaseType, releaseNotes, checksum, totalSize }
       |
       +--[uploadType = SINGLE]---------> PUT uploadUrl (file body)
       |                                         |
       +--[uploadType = MULTIPART]-----> PUT each chunkUrl (10 MB chunks, 3 at a time)
                                                 |
                                         POST /ota/packages/upload-artefact/complete
                                           { packageName, version, parts: [{partNumber, etag}] }
                                                 |
                                                 v
                              Poll GET /ota/packages/:packageName/:version
                              every 2 s (max 30 attempts = 60 s)
                              until status = ACTIVE or CORRUPTED
```

---

## Package Lifecycle

```
Upload initiated
      |
      v
   PENDING   <- binary in S3, artifact_processor verifying
      |
   +--+--+
   |     |
ACTIVE  CORRUPTED   <- SHA-256 mismatch or processing error
   |
   +-- activated = false (default after processing)
   |
   +-- [Publish]  --> activated = true   (devices can receive this)
   +-- [Withdraw] --> activated = false  (devices can no longer receive this)
   +-- [Recall]   --> status = RECALLED  (permanently removed, audit flagged)
```

**Status values:**

| Status | Meaning |
|---|---|
| `PENDING` | Binary uploaded, backend verifying |
| `ACTIVE` | Verified, ready for deployment |
| `CORRUPTED` | Verification failed (checksum mismatch) |
| `RECALLED` | Permanently revoked, no longer distributed |

---

## Deployment Lifecycle

Deployments map to **AWS IoT Jobs**. Status values mirror IoT Job statuses:

| Status | Meaning |
|---|---|
| `IN_PROGRESS` | Job is being executed by one or more devices |
| `QUEUED` | Job created, devices not yet started |
| `SUCCEEDED` | All targeted devices completed successfully |
| `FAILED` | One or more devices failed |
| `CANCELLED` | Job was aborted before completion |

**Rollback** creates a fresh deployment job targeting the same devices but with the nearest lower published version of the same package.

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
