# Digilux OTA API — cURL Reference

**Base URL:** `https://iot.digilux.co.in/smarthome/api/v1`

---

## Auth Setup

Run once and reuse `$ADMIN_TOKEN` / `$USER_TOKEN` throughout.

> **Important:**
> - Always extract the **`IdToken`**, not the `AccessToken` — API Gateway validates ID tokens only.
> - Pass the token **without** a `Bearer` prefix in the `Authorization` header.
> - Tokens expire after **1 hour** — re-run the auth command to get a fresh one.

```bash
BASE="https://iot.digilux.co.in/smarthome/api/v1"
COGNITO="https://cognito-idp.ap-south-1.amazonaws.com/"

# Admin token — OTA admin Cognito pool
ADMIN_TOKEN=$(curl -s -X POST "$COGNITO" \
  -H "Content-Type: application/x-amz-json-1.1" \
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth" \
  -d '{
    "AuthFlow": "USER_PASSWORD_AUTH",
    "ClientId": "2qmig1uh220ttntbl0gfvcde4f",
    "AuthParameters": { "USERNAME": "your@email.com", "PASSWORD": "yourpassword" }
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['AuthenticationResult']['IdToken'])")

# User token — main app Cognito pool (for device-side endpoints)
USER_TOKEN=$(curl -s -X POST "$COGNITO" \
  -H "Content-Type: application/x-amz-json-1.1" \
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth" \
  -d '{
    "AuthFlow": "USER_PASSWORD_AUTH",
    "ClientId": "q7189jitfkk4ttesepkgls491",
    "AuthParameters": { "USERNAME": "user@email.com", "PASSWORD": "userpassword" }
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['AuthenticationResult']['IdToken'])")
```

---

## Packages

### List packages
Optional query params: `status` (`ACTIVE` | `PENDING` | `CORRUPTED` | `RECALLED`), `deviceType`

```bash
curl -s "$BASE/ota/packages?status=ACTIVE&deviceType=Network_controller_firmware" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

### Get single package

```bash
curl -s "$BASE/ota/packages/{packageName}/{version}" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

### Initiate upload

Returns `uploadUrl` + `uploadToken` for files ≤ 10 MB (`SINGLE`), or `chunkUrls` for files > 10 MB (`MULTIPART`).

```bash
# Get SHA256 and file size first
CHECKSUM=$(shasum -a 256 /path/to/firmware.bin | awk '{print $1}')
FILESIZE=$(wc -c < /path/to/firmware.bin | tr -d ' ')

curl -s -X POST "$BASE/ota/packages/upload-artefact" \
  -H "Authorization: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"deviceType\":   \"Network_controller_firmware\",
    \"version\":      \"1.0.0\",
    \"releaseType\":  \"UAT\",
    \"releaseNotes\": \"Fixed zigbee reconnect loop on cold boot (required, 20–500 chars)\",
    \"checksum\":     \"$CHECKSUM\",
    \"totalSize\":    $FILESIZE
  }" | python3 -m json.tool
```

### PUT binary to S3 (SINGLE upload)

Use `uploadUrl` and `uploadToken` from the initiate response above.

```bash
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: application/octet-stream" \
  -H "x-amz-meta-upload-token: <uploadToken>" \
  --data-binary @/path/to/firmware.bin
```

### Complete multipart upload (files > 10 MB only)

```bash
curl -s -X POST "$BASE/ota/packages/upload-artefact/complete" \
  -H "Authorization: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "packageName": "<packageName>",
    "version":     "1.0.0",
    "parts":       [{"partNumber": 1, "etag": "<etag>"}]
  }' | python3 -m json.tool
```

### Publish package

Makes the package available to devices.

```bash
curl -s -X PATCH "$BASE/ota/packages/{packageName}/{version}/activate" \
  -H "Authorization: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"activated": true}' | python3 -m json.tool
```

### Withdraw package

```bash
curl -s -X PATCH "$BASE/ota/packages/{packageName}/{version}/activate" \
  -H "Authorization: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"activated": false}' | python3 -m json.tool
```

### Recall package

```bash
curl -s -X PATCH "$BASE/ota/packages/{packageName}/{version}/activate" \
  -H "Authorization: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recalled": true, "recallReason": "Critical bug found"}' | python3 -m json.tool
```

---

## Deployments

### List deployments

```bash
curl -s "$BASE/ota/deployments" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

### Get single deployment

```bash
curl -s "$BASE/ota/deployments/{jobId}" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

### Create deployment — BETA (specific device)

Deployments are **consent-gated** — no IoT Job is created immediately.
A PENDING consent record is written for each target device. The IoT Job
is only created when the device owner taps YES in the Flutter app.

```bash
curl -s -X POST "$BASE/ota/deployments" \
  -H "Authorization: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "packageName":  "<packageName>",
    "version":      "1.0.0",
    "rolloutStage": "BETA",
    "targetIds":    ["<deviceId-uuid>"]
  }' | python3 -m json.tool
```

### Create deployment — PRODUCTION (THING_GROUP)

```bash
curl -s -X POST "$BASE/ota/deployments" \
  -H "Authorization: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "packageName":  "<packageName>",
    "version":      "1.0.0",
    "targetType":   "THING_GROUP",
    "targetId":     "DGX-Canary",
    "rolloutStage": "PRODUCTION"
  }' | python3 -m json.tool
```

**Example response (201):**
```json
{
  "jobId": "digilux-ota-HomeAssistantUtility-4-5-0-1790072620",
  "status": "AWAITING_CONSENT",
  "consentCount": 1,
  "message": "Deployment created. Consent notifications sent to 1 device(s)."
}
```

### Get deployment detail (with consent stats)

```bash
curl -s "$BASE/ota/deployments/{jobId}" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

**Example response fragment:**
```json
{
  "status": "AWAITING_CONSENT",
  "consentCount": 3,
  "consentStats": { "PENDING": 2, "ACCEPTED": 1, "DECLINED": 0 }
}
```

### Abort deployment

Cancels all PENDING consent records for `AWAITING_CONSENT` deployments,
or cancels the IoT Job for active deployments.

```bash
curl -s -X POST "$BASE/ota/deployments/{jobId}/abort" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

---

## Beta Users

### List beta users

```bash
curl -s "$BASE/ota/beta-users" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

### Add beta user by email

Auto-resolves email → Cognito userId → deviceId.

```bash
curl -s -X POST "$BASE/ota/beta-users" \
  -H "Authorization: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}' | python3 -m json.tool
```

### Remove beta user

```bash
# Note: URL-encode the @ in the email address
curl -s -X DELETE "$BASE/ota/beta-users/user%40example.com" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

---

## Device / User Endpoints

> **Different base URL:** Device-side endpoints live at `https://iot.digilux.co.in/api/v1` — not the admin base URL.
>
> **Different auth:** `$USER_TOKEN` must be an **OAuth 2.0 PKCE access token** carrying the `smarthome_server/read smarthome_server/write` scopes. A plain `USER_PASSWORD_AUTH` token will be rejected with 401.
> Pass it with a `Bearer` prefix — unlike the admin token.

```bash
DEVICE_BASE="https://iot.digilux.co.in/api/v1"
```

### Check device compatibility (admin)

```bash
curl -s "$BASE/controllers/{deviceId}/updates/available" \
  -H "Authorization: $ADMIN_TOKEN" | python3 -m json.tool
```

### Device checks for available updates

Returns available updates for all devices owned by the user. Response includes `releaseNotes` for the available version.

```bash
curl -s "$DEVICE_BASE/ota/device/available-updates" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -m json.tool
```

**Example response:**
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

### User consents to update

```bash
curl -s -X POST "$DEVICE_BASE/ota/my/updates/consent" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"packageName": "<packageName>", "version": "1.0.0"}' | python3 -m json.tool
```

### Get signed download link for firmware

```bash
curl -s -X POST "$DEVICE_BASE/ota/my/updates/download-link" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"packageName": "<packageName>", "version": "1.0.0"}' | python3 -m json.tool
```

### Track update job status

```bash
curl -s "$DEVICE_BASE/ota/my/updates/{jobId}/status" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -m json.tool
```

---

## Quick Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/ota/packages` | Admin | List packages |
| GET | `/ota/packages/{name}/{version}` | Admin | Get package |
| POST | `/ota/packages/upload-artefact` | Admin | Initiate upload |
| POST | `/ota/packages/upload-artefact/complete` | Admin | Complete multipart |
| PATCH | `/ota/packages/{name}/{version}/activate` | Admin | Publish / Withdraw / Recall |
| GET | `/ota/deployments` | Admin | List deployments |
| GET | `/ota/deployments/{jobId}` | Admin | Get deployment |
| POST | `/ota/deployments` | Admin | Create deployment |
| POST | `/ota/deployments/{jobId}/abort` | Admin | Abort deployment |
| GET | `/ota/beta-users` | Admin | List beta users |
| POST | `/ota/beta-users` | Admin | Add beta user |
| DELETE | `/ota/beta-users/{email}` | Admin | Remove beta user |
| GET | `/controllers/{deviceId}/updates/available` | Admin | Check device compatibility |
| GET | `/ota/device/available-updates` | User | Device checks for updates |
| POST | `/ota/my/updates/consent` | User | Consent to update |
| POST | `/ota/my/updates/download-link` | User | Get download link |
| GET | `/ota/my/updates/{jobId}/status` | User | Track job status |
