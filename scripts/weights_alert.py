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

WATCHED_UIDS = {
    0: "primary (Leadpoet)",
    202: "auditor (TAO.com)",
    142: "auditor (Yuma)",
    179: "auditor (Rizzo)",
    62: "auditor (Opentensor Fdn)",
}
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

    state = load_state()
    stale_blocks = tempo + SUBMISSION_GRACE_BLOCKS
    misses = []
    for uid, label in WATCHED_UIDS.items():
        if uid >= len(mg.hotkeys):
            continue
        last_set_block = int(mg.last_update[uid])
        blocks_since = block - last_set_block
        if blocks_since > stale_blocks and state.get(str(uid)) != epoch_index:
            misses.append((uid, label, last_set_block, blocks_since))
            state[str(uid)] = epoch_index

    if misses:
        epoch_block = max(0, block - last_epoch_block)
        lines = [
            f"🚨 **SN71 missed weight set** "
            f"(official epoch {epoch_index}, block {epoch_block}/{tempo} into it)"
        ]
        for uid, label, last_set_block, behind in misses:
            lines.append(
                f"• UID {uid} {label}: last set at block {last_set_block}, "
                f"{behind} blocks since last update"
            )
        if any(uid == 0 for uid, *_ in misses):
            lines.append(
                "Primary miss ⇒ auditors have no bundle to copy; check gateway "
                "/weights/submit responses and the validator log."
            )
        post_discord("\n".join(lines))
        log(f"ALERTED: {[(m[0], m[3]) for m in misses]}")
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
