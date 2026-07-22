#!/usr/bin/env python3
"""SN71 missed-weight alerting on the official stateful subnet epoch.

Runs from cron on the validator box (deployed copy:
/home/ec2-user/weights_alert.py, executed with the box's alert venv).
Checks the primary validator and the audit validators against the official
subnet epoch authority — ``SubnetEpochIndex`` anchored by ``LastEpochBlock``
with the on-chain ``Tempo`` — the same authority the dashboard uses, NOT the
legacy ``block // 360`` bucket. A validator is stale when its ``last_update``
is more than one full tempo (plus a submission grace) behind the chain head.

Posts one combined message to the Discord webhook per official epoch per UID
(deduped in STATE_FILE). Webhook URL lives in WEBHOOK_FILE (one line);
empty/missing file = log-only mode.

Usage: weights_alert.py [--test]   (--test posts a labeled test message)
"""

import json
import os
import sys
import time
import urllib.request

# Watched validators are identified by hotkey (the stable identity) in
# validator_registry.json, shared with the dashboard UI. UIDs are resolved
# live from the metagraph each pass, so a re-registration that moves a
# validator to a new UID is followed automatically; a hotkey rotation is a
# deliberate reviewed edit to the registry, never an automatic follow.
REGISTRY_ENV = "WEIGHTS_ALERT_REGISTRY"
REGISTRY_CANDIDATES = (
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "validator_registry.json"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "validator_registry.json"),
    os.path.expanduser("~/validator_registry.json"),
)


def load_registry() -> list:
    paths = [os.environ.get(REGISTRY_ENV, "")] if os.environ.get(REGISTRY_ENV) else []
    paths.extend(REGISTRY_CANDIDATES)
    for candidate in paths:
        try:
            with open(candidate) as handle:
                doc = json.load(handle)
            validators = doc.get("validators")
            if isinstance(validators, list) and validators:
                return validators
        except Exception:
            continue
    return []


NETUID = 71
# A validator that submits every epoch is at most tempo + a few submission
# blocks behind the head. The grace mirrors the dashboard's weights watch.
SUBMISSION_GRACE_BLOCKS = 20
WEBHOOK_FILE = os.path.expanduser("~/.config/leadpoet/weights_alert_webhook")
STATE_FILE = os.path.expanduser("~/.config/leadpoet/weights_alert_state.json")
LOG_FILE = os.path.expanduser("~/weights_alert.log")


def log(msg: str) -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(LOG_FILE, "a") as handle:
        handle.write(f"{stamp} {msg}\n")


def load_state() -> dict:
    try:
        with open(STATE_FILE) as handle:
            return json.load(handle)
    except Exception:
        return {}


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as handle:
        json.dump(state, handle)
    os.replace(tmp, STATE_FILE)


def webhook_url() -> str:
    try:
        with open(WEBHOOK_FILE) as handle:
            return handle.read().strip()
    except Exception:
        return ""


def post_discord(content: str) -> bool:
    url = webhook_url()
    if not url:
        log(f"log-only (no webhook): {content!r}")
        return False
    body = json.dumps({"content": content}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        # Discord's edge rejects the default Python-urllib user agent (403),
        # so identify as the monitor explicitly.
        headers={
            "Content-Type": "application/json",
            "User-Agent": "leadpoet-sn71-weights-watch/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return 200 <= response.status < 300
    except Exception as exc:
        # A dead webhook must not crash the pass: alert state still saves so
        # a later repaired webhook does not replay every old miss at once.
        log(f"discord post failed: {exc}")
        return False


def _scale(value):
    inner = getattr(value, "value", value)
    return int(inner or 0)


def official_epoch_state(subtensor):
    """(subnet_epoch_index, last_epoch_block, tempo, block) at one block hash.

    Every storage field is read at the same block hash so the snapshot is
    coherent, matching the dashboard's official epoch authority.
    """
    substrate = subtensor.substrate
    block_hash = substrate.get_chain_head()
    block = _scale(
        substrate.query(
            module="System", storage_function="Number", block_hash=block_hash
        )
    )
    fields = {}
    for name in ("SubnetEpochIndex", "LastEpochBlock", "Tempo"):
        fields[name] = _scale(
            substrate.query(
                module="SubtensorModule",
                storage_function=name,
                params=[NETUID],
                block_hash=block_hash,
            )
        )
    return fields["SubnetEpochIndex"], fields["LastEpochBlock"], fields["Tempo"], block


def main() -> int:
    if "--test" in sys.argv:
        sent = post_discord(
            "✅ SN71 weights watch: test message (official-epoch alerting is wired up)"
        )
        print("test message sent" if sent else "log-only (no webhook configured)")
        return 0

    try:
        import bittensor as bt

        st = bt.Subtensor(network="finney")
        epoch_index, last_epoch_block, tempo, block = official_epoch_state(st)
        mg = st.metagraph(NETUID)
    except Exception as exc:
        # A flaky chain endpoint must not produce false pages; the next cron
        # run retries in five minutes.
        log(f"chain query failed (skipping this pass): {exc}")
        return 0

    if tempo <= 0:
        log(f"invalid tempo {tempo} (skipping this pass)")
        return 0

    validators = load_registry()
    if not validators:
        log("no validator registry found (skipping this pass)")
        return 0

    state = load_state()
    stale_blocks = tempo + SUBMISSION_GRACE_BLOCKS
    hotkeys = list(mg.hotkeys)
    hotkey_to_uid = {hk: i for i, hk in enumerate(hotkeys)}
    misses = []
    for validator in validators:
        vid = str(validator.get("id") or validator.get("hotkey") or "")[:64]
        label = str(validator.get("label") or vid)
        hotkey = str(validator.get("hotkey") or "")
        expected_coldkey = str(validator.get("expectedColdkey") or "")
        if not vid or not hotkey:
            continue
        problems = []
        uid = hotkey_to_uid.get(hotkey)
        last_set_block = None
        blocks_since = None
        if uid is None:
            problems.append("hotkey no longer registered")
        else:
            coldkey = str(mg.coldkeys[uid])
            if expected_coldkey and coldkey != expected_coldkey:
                problems.append("unexpected coldkey")
            if not bool(mg.validator_permit[uid]):
                problems.append("validator permit lost")
            if not bool(mg.active[uid]):
                problems.append("validator inactive")
            last_set_block = int(mg.last_update[uid])
            blocks_since = block - last_set_block
            if blocks_since > stale_blocks:
                problems.append(
                    f"weight update stale ({blocks_since} blocks since last set)"
                )
        # Deduplicate per validator identity and official epoch — never per
        # UID, which can change under the validator.
        if problems and state.get(vid) != epoch_index:
            misses.append((vid, label, uid, last_set_block, blocks_since, problems))
            state[vid] = epoch_index

    if misses:
        epoch_block = max(0, block - last_epoch_block)
        lines = [
            f"🚨 **SN71 missed weight set** "
            f"(official epoch {epoch_index}, block {epoch_block}/{tempo} into it)"
        ]
        for vid, label, uid, last_set_block, behind, problems in misses:
            uid_text = f"current UID {uid}" if uid is not None else "not registered"
            set_text = (
                f", last set {behind} blocks ago" if behind is not None else ""
            )
            lines.append(f"• {label} · {uid_text}{set_text}: " + "; ".join(problems))
        if any(vid == "leadpoet-primary" for vid, *_ in misses):
            lines.append(
                "Primary miss ⇒ auditors have no bundle to copy; check gateway "
                "/weights/submit responses and the validator log."
            )
        post_discord("\n".join(lines))
        log(f"ALERTED: {[(m[0], m[5]) for m in misses]}")
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
