"""
digilux_ota_job_create
Creates a consent-gated OTA deployment.
Admin triggers, devices cannot be updated without explicit user consent.

POST /api/v1/ota/deployments
Admin-only.

Body:
{
  "packageName":  "HomeAssistantUtility",
  "version":      "4.5.0",
  "targetType":   "THING" | "THING_GROUP",
  "targetId":     "deviceId-uuid"  |  "DGX-Canary",
  "rolloutStage": "BETA" | "UAT" | "PRODUCTION",
  "rolloutConfig": {}   # optional overrides
}

Flow:
  1. Validate package is ACTIVE.
  2. Resolve target devices.
  3. Write deployment record (status=AWAITING_CONSENT) to digilux_ota_jobs.
  4. Write one PENDING consent record per device to digilux_ota_user_consents.
  5. Return deployment info — no IoT Job is created here.
  IoT Jobs are created by digilux_ota_user_consent when the user taps YES.
"""
import datetime
import json
import logging
import os
import time
import uuid
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

log = logging.getLogger()
log.setLevel(logging.INFO)


def _audit(event: str, actor: str, resource: dict, result: str, **extra) -> None:
    print(json.dumps({
        "audit": True,
        "event": event,
        "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "actor": actor,
        "resource": resource,
        "result": result,
        **extra,
    }))


class _DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


REGION           = os.environ["REGION"]
ACCOUNT_ID       = os.environ["ACCOUNT_ID"]
PACKAGES_TABLE   = os.environ.get("PACKAGES_TABLE",   "digilux_ota_packages")
DEVICE_DATA_TABLE = os.environ.get("DEVICE_DATA_TABLE", "digilux_device_data")
OTA_JOBS_TABLE   = os.environ.get("OTA_JOBS_TABLE",   "digilux_ota_jobs")
CONSENTS_TABLE   = os.environ.get("CONSENTS_TABLE",   "digilux_ota_user_consents")
BETA_USERS_TABLE = os.environ.get("BETA_USERS_TABLE", "digilux_ota_beta_users")

dynamo = boto3.resource("dynamodb", region_name=REGION)
iot    = boto3.client("iot",       region_name=REGION)

# Staged rollout defaults (startup scale)
ROLLOUT_CONFIGS = {
    "BETA":       {"maximumPerMinute": 2},
    "CUSTOM":     {"maximumPerMinute": 2},
    "CANARY":     {"maximumPerMinute": 2},
    "UAT": {
        "maximumPerMinute": 5,
        "exponentialRate": {
            "baseRatePerMinute": 2,
            "incrementFactor": 2,
            "rateIncreaseCriteria": {"numberOfSucceededThings": 5},
        },
    },
    "PRODUCTION": {
        "maximumPerMinute": 20,
        "exponentialRate": {
            "baseRatePerMinute": 5,
            "incrementFactor": 2,
            "rateIncreaseCriteria": {"numberOfSucceededThings": 20},
        },
    },
}


# ──────────────────────────────────────────────────────────────────────────────
# Device resolution helpers
# ──────────────────────────────────────────────────────────────────────────────

def _get_device_by_id(device_id: str) -> dict | None:
    """Query device_data by deviceId (hash key). Returns first item or None."""
    items = dynamo.Table(DEVICE_DATA_TABLE).query(
        KeyConditionExpression=Key("deviceId").eq(device_id)
    ).get("Items", [])
    return items[0] if items else None


def _resolve_thing_group_devices(group_name: str) -> list[dict]:
    """
    Enumerate all thingNames in an IoT thing group, then look up each in
    device_data to get deviceId + userId.  Scan once, build lookup map.
    Returns list of {deviceId, userId, thingName, macAddress}.
    """
    # 1. Get all thing names in the group (paginated)
    thing_names = []
    paginator = iot.get_paginator("list_things_in_thing_group")
    for page in paginator.paginate(thingGroupName=group_name):
        thing_names.extend(page.get("things", []))

    if not thing_names:
        log.warning(f"Thing group {group_name} is empty or does not exist")
        return []

    log.info(f"Thing group {group_name} has {len(thing_names)} devices")

    # 2. Scan device_data once; build thingName → device_record map
    tbl = dynamo.Table(DEVICE_DATA_TABLE)
    name_set = set(thing_names)
    device_map = {}
    scan_kwargs = {}
    while True:
        resp = tbl.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            tn = item.get("thingName")
            if tn in name_set:
                device_map[tn] = item
        if "LastEvaluatedKey" not in resp:
            break
        scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    # 3. Build result list
    resolved = []
    for tn in thing_names:
        item = device_map.get(tn)
        if not item:
            log.warning(f"thingName={tn} not found in device_data — skipping")
            continue
        if not item.get("userId"):
            log.warning(f"thingName={tn} has no userId in device_data — skipping")
            continue
        resolved.append({
            "deviceId":   item["deviceId"],
            "userId":     item["userId"],
            "thingName":  tn,
            "macAddress": item.get("macAddress", ""),
        })

    log.info(f"Resolved {len(resolved)} devices with userId for group {group_name}")
    return resolved


def _create_consent_records(deployment_id: str, devices: list[dict],
                             pkg_name: str, version: str) -> int:
    """
    Write one PENDING consent record per device.
    Returns the number of records created.
    """
    now_ms = int(time.time() * 1000)

    tbl = dynamo.Table(CONSENTS_TABLE)
    count = 0
    for dev in devices:
        consent_id = str(uuid.uuid4())
        tbl.put_item(Item={
            "consentId":    consent_id,
            "deploymentId": deployment_id,
            "userId":       dev["userId"],
            "deviceId":     dev["deviceId"],
            "packageName":  pkg_name,
            "version":      version,
            "status":       "PENDING",
            "createdAt":    now_ms,
        })
        count += 1

    log.info(f"Created {count} PENDING consent records for deployment {deployment_id}")
    return count


# ──────────────────────────────────────────────────────────────────────────────
# Handler
# ──────────────────────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    method       = event.get("httpMethod", "POST").upper()
    path_params  = event.get("pathParameters") or {}
    job_id_param = path_params.get("jobId")
    log.info(json.dumps({"msg": "request_received", "method": method,
                         "jobId": job_id_param, "path": event.get("path", "")}))

    try:
        claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
        if "ota-admin" not in claims.get("cognito:groups", ""):
            log.warning("Unauthorized access attempt — not in admin group")
            return _response(403, {"error": "Admin access required"})

        caller = claims.get("email", claims.get("sub", "unknown"))

        if method == "GET" and job_id_param:
            return _get_job(job_id_param)
        if method == "GET":
            return _list_jobs(event)
        if method == "POST" and job_id_param:
            return _abort_job(job_id_param, claims)

        # ── POST /ota/deployments — create deployment ─────────────────────────
        body = json.loads(event.get("body") or "{}")
        for field in ["packageName", "version"]:
            if not body.get(field):
                return _response(400, {"error": f"Missing required field: {field}"})

        pkg_name      = body["packageName"]
        version       = body["version"]
        rollout_stage = body.get("rolloutStage", "PRODUCTION").upper()

        if rollout_stage not in ROLLOUT_CONFIGS:
            return _response(400, {"error": f"rolloutStage must be one of: {', '.join(ROLLOUT_CONFIGS)}"})

        # Resolve target devices
        if rollout_stage == "BETA":
            device_table = dynamo.Table(DEVICE_DATA_TABLE)
            target_ids   = body.get("targetIds", [])
            if not target_ids:
                return _response(400, {"error": "No beta users selected. Select at least one beta user."})
            devices = []
            for device_id in target_ids:
                items = device_table.query(
                    KeyConditionExpression=Key("deviceId").eq(device_id)
                ).get("Items", [])
                if not items:
                    log.warning(f"Beta deviceId={device_id} not found — skipping")
                    continue
                item = items[0]
                if not item.get("userId"):
                    log.warning(f"Beta deviceId={device_id} has no userId — skipping")
                    continue
                devices.append({
                    "deviceId":  device_id,
                    "userId":    item["userId"],
                    "thingName": item.get("thingName", ""),
                    "macAddress": item.get("macAddress", ""),
                })
            if not devices:
                return _response(400, {"error": "None of the selected beta users have a registered device."})
            target_type = "THING_LIST"
            target_id   = ",".join(d["deviceId"] for d in devices)

        elif rollout_stage == "CUSTOM":
            target_ids = body.get("targetIds", [])
            if not target_ids:
                return _response(400, {"error": "No device IDs provided for CUSTOM deployment."})
            device_table = dynamo.Table(DEVICE_DATA_TABLE)
            devices = []
            for device_id in target_ids:
                items = device_table.query(
                    KeyConditionExpression=Key("deviceId").eq(device_id)
                ).get("Items", [])
                if not items:
                    log.warning(f"DeviceId={device_id} not found — skipping")
                    continue
                item = items[0]
                devices.append({
                    "deviceId":  device_id,
                    "userId":    item.get("userId", ""),
                    "thingName": item.get("thingName", ""),
                    "macAddress": item.get("macAddress", ""),
                })
            if not devices:
                return _response(400, {"error": "None of the provided device IDs were found."})
            target_type = "THING_LIST"
            target_id   = ",".join(d["deviceId"] for d in devices)

        else:
            target_type = (body.get("targetType") or "").upper()
            target_id   = body.get("targetId", "")
            if not target_type or not target_id:
                return _response(400, {"error": "Missing required fields: targetType, targetId"})
            if target_type not in ("THING", "THING_GROUP"):
                return _response(400, {"error": "targetType must be THING or THING_GROUP"})

            if target_type == "THING":
                dev = _get_device_by_id(target_id)
                if not dev:
                    return _response(404, {"error": f"Device {target_id} not found in OTA inventory."})
                if not dev.get("userId"):
                    return _response(400, {"error": f"Device {target_id} has no registered user."})
                devices = [{
                    "deviceId":   target_id,
                    "userId":     dev["userId"],
                    "thingName":  dev.get("thingName", ""),
                    "macAddress": dev.get("macAddress", ""),
                }]
            else:  # THING_GROUP
                devices = _resolve_thing_group_devices(target_id)
                if not devices:
                    return _response(400, {
                        "error": f"Thing group '{target_id}' has no registered devices."
                    })

        # Validate package is ACTIVE
        pkg = dynamo.Table(PACKAGES_TABLE).get_item(
            Key={"packageName": pkg_name, "version": version}
        ).get("Item")
        if not pkg:
            return _response(404, {"error": f"Package {pkg_name}@{version} not found"})
        if pkg.get("status") != "ACTIVE":
            return _response(400, {"error": f"Package {pkg_name}@{version} is not ACTIVE"})

        # Create deployment record
        deployment_id = f"digilux-ota-{pkg_name}-{version}-{int(time.time())}".replace(".", "-")
        now_ms = int(time.time() * 1000)

        rollout_cfg = ROLLOUT_CONFIGS[rollout_stage].copy()
        if body.get("rolloutConfig"):
            rollout_cfg.update(body["rolloutConfig"])

        dynamo.Table(OTA_JOBS_TABLE).put_item(Item={
            "jobId":          deployment_id,
            "packageName":    pkg_name,
            "version":        version,
            "deviceType":     pkg.get("deviceType", ""),
            "targetType":     target_type,
            "targetId":       target_id,
            "rolloutStage":   rollout_stage,
            "status":         "AWAITING_CONSENT",
            "createdAt":      now_ms,
            "createdBy":      caller,
            "consentCount":   len(devices),
            "deviceStatuses": {},
        })
        log.info(f"Deployment record created: {deployment_id}, consentCount={len(devices)}")

        # Create one PENDING consent record per device
        consent_count = _create_consent_records(deployment_id, devices, pkg_name, version)

        _audit("DEPLOYMENT_CREATED", caller,
               {"packageName": pkg_name, "version": version},
               "SUCCESS",
               deploymentId=deployment_id,
               targetType=target_type, targetId=target_id,
               rolloutStage=rollout_stage, consentCount=consent_count,
               deviceType=pkg.get("deviceType", ""),
               awaitingConsent=True)

        log.info(json.dumps({
            "msg":          "deployment_created_awaiting_consent",
            "deploymentId": deployment_id,
            "packageName":  pkg_name,
            "version":      version,
            "consentCount": consent_count,
            "createdBy":    caller,
        }))

        return _response(201, {
            "jobId":          deployment_id,
            "packageName":    pkg_name,
            "version":        version,
            "targetType":     target_type,
            "targetId":       target_id,
            "rolloutStage":   rollout_stage,
            "status":         "AWAITING_CONSENT",
            "consentCount":   consent_count,
            "message": f"Deployment created. Consent notifications sent to {consent_count} device(s).",
        })

    except ClientError as e:
        code = e.response["Error"]["Code"]
        msg  = e.response["Error"]["Message"]
        log.error(json.dumps({"msg": "aws_client_error", "code": code, "error": msg}))
        return _response(500, {"error": f"AWS error: {msg}"})
    except Exception as e:
        log.exception(f"Unhandled error in job_create handler: {e}")
        return _response(500, {"error": "Internal server error"})


def _get_job(job_id: str) -> dict:
    """GET /ota/deployments/{jobId} — deployment detail with consent stats."""
    item = dynamo.Table(OTA_JOBS_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        return _response(404, {"error": f"Job {job_id} not found"})

    # Enrich live IoT status if an actual IoT Job exists
    iot_job_id = item.get("iotJobId")
    if iot_job_id:
        try:
            iot_job = iot.describe_job(jobId=iot_job_id)["job"]
            item["iotStatus"]    = iot_job.get("jobProcessDetails", {})
            item["iotJobStatus"] = iot_job.get("status")
        except Exception as e:
            log.warning(f"Could not fetch live IoT status for {iot_job_id}: {e}")
    elif item.get("status") not in ("AWAITING_CONSENT",):
        # Legacy: jobId IS the iotJobId
        try:
            iot_job = iot.describe_job(jobId=job_id)["job"]
            item["iotStatus"]    = iot_job.get("jobProcessDetails", {})
            item["iotJobStatus"] = iot_job.get("status")
        except Exception as e:
            log.warning(f"Could not fetch live IoT status for {job_id}: {e}")

    # Consent stats from deploymentId-index GSI
    try:
        resp = dynamo.Table(CONSENTS_TABLE).query(
            IndexName="deploymentId-index",
            KeyConditionExpression=Key("deploymentId").eq(job_id),
        )
        consents = resp.get("Items", [])
        stats = {"PENDING": 0, "ACCEPTED": 0, "DECLINED": 0}
        for c in consents:
            s = c.get("status", "PENDING")
            if s in stats:
                stats[s] += 1
        item["consentStats"] = stats
    except Exception as e:
        log.warning(f"Could not fetch consent stats for {job_id}: {e}")

    return _response(200, json.loads(json.dumps(item, cls=_DecimalEncoder)))


def _list_jobs(event: dict) -> dict:
    """GET /ota/deployments — list OTA jobs, newest first."""
    params = event.get("queryStringParameters") or {}
    limit  = min(int(params.get("limit", 20)), 100)

    result = dynamo.Table(OTA_JOBS_TABLE).scan()
    items  = result.get("Items", [])
    items.sort(key=lambda x: int(x.get("createdAt", 0)), reverse=True)
    items  = items[:limit]

    jobs = [
        {
            "jobId":        i.get("jobId"),
            "packageName":  i.get("packageName"),
            "version":      i.get("version"),
            "deviceType":   i.get("deviceType"),
            "targetType":   i.get("targetType"),
            "targetId":     i.get("targetId"),
            "rolloutStage": i.get("rolloutStage"),
            "status":       i.get("status"),
            "createdBy":    i.get("createdBy"),
            "createdAt":    int(i["createdAt"]) if "createdAt" in i else None,
            "completedAt":  int(i["completedAt"]) if "completedAt" in i else None,
            "consentCount": int(i["consentCount"]) if "consentCount" in i else None,
        }
        for i in items
    ]
    return _response(200, {"jobs": jobs, "count": len(jobs)})


def _abort_job(job_id: str, claims: dict) -> dict:
    """POST /ota/deployments/{jobId}/abort."""
    actor = claims.get("email", claims.get("sub", "unknown"))
    log.info(f"Abort requested for jobId={job_id} by {actor}")
    try:
        job_item = dynamo.Table(OTA_JOBS_TABLE).get_item(Key={"jobId": job_id}).get("Item", {})
        status      = job_item.get("status", "")
        target_type = job_item.get("targetType")
        target_id   = job_item.get("targetId")

        now_ms = int(time.time() * 1000)

        if status == "AWAITING_CONSENT":
            # Cancel all PENDING consent records for this deployment
            resp = dynamo.Table(CONSENTS_TABLE).query(
                IndexName="deploymentId-index",
                KeyConditionExpression=Key("deploymentId").eq(job_id),
            )
            cancelled = 0
            for c in resp.get("Items", []):
                if c.get("status") == "PENDING":
                    dynamo.Table(CONSENTS_TABLE).update_item(
                        Key={"consentId": c["consentId"]},
                        UpdateExpression="SET #s = :s, cancelledAt = :ts, cancelledBy = :by",
                        ExpressionAttributeNames={"#s": "status"},
                        ExpressionAttributeValues={
                            ":s":  "CANCELLED",
                            ":ts": now_ms,
                            ":by": actor,
                        },
                    )
                    cancelled += 1
            log.info(f"Cancelled {cancelled} PENDING consent records for deployment {job_id}")
        else:
            # Try to cancel the IoT Job (legacy or post-consent jobs)
            iot_job_id = job_item.get("iotJobId", job_id)
            try:
                iot.cancel_job(jobId=iot_job_id, force=False)
                log.info(f"IoT Job {iot_job_id} cancelled")
            except ClientError as ce:
                log.warning(f"Could not cancel IoT Job {iot_job_id}: {ce}")

        dynamo.Table(OTA_JOBS_TABLE).update_item(
            Key={"jobId": job_id},
            UpdateExpression="SET #s = :s, abortedAt = :ts, abortedBy = :by",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":s":  "CANCELLED",
                ":ts": now_ms,
                ":by": actor,
            },
        )

        # Clear pendingJobId from device_data if THING-targeted
        if target_type == "THING" and target_id:
            dev_items = dynamo.Table(DEVICE_DATA_TABLE).query(
                KeyConditionExpression=Key("deviceId").eq(target_id)
            ).get("Items", [])
            if dev_items:
                mac = dev_items[0].get("macAddress", "")
                dynamo.Table(DEVICE_DATA_TABLE).update_item(
                    Key={"deviceId": target_id, "macAddress": mac},
                    UpdateExpression="SET pendingJobId = :null, lastUpdatedAt = :ts",
                    ExpressionAttributeValues={":null": None, ":ts": now_ms},
                )

        _audit("DEPLOYMENT_ABORTED", actor, {"jobId": job_id}, "SUCCESS",
               abortedBy=actor, targetType=target_type, targetId=target_id)
        return _response(200, {"jobId": job_id, "status": "CANCELLED"})

    except ClientError as e:
        msg = e.response["Error"]["Message"]
        log.error(f"Failed to abort deployment {job_id}: {msg}")
        _audit("DEPLOYMENT_ABORT_FAILED", actor, {"jobId": job_id}, "FAILURE", error=msg)
        return _response(400, {"error": msg})


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body, cls=_DecimalEncoder),
    }
