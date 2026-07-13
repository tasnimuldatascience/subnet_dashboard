#!/usr/bin/env python3
"""Fetch metagraph data from Bittensor network"""

import json
import ipaddress
import sys


def optional_nonnegative_int(value):
    """Convert Bittensor scalars/tensors to JSON-safe block numbers."""
    if value is None:
        return None
    try:
        value = value.item() if hasattr(value, 'item') else value
        parsed = int(value)
        return parsed if parsed >= 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def scalar_float(value, default=0.0):
    """Convert tensor/scalar metagraph fields to ordinary floats."""
    if value is None:
        return default
    try:
        value = value.item() if hasattr(value, 'item') else value
        return float(value)
    except (TypeError, ValueError, OverflowError):
        return default


def metric_at(metagraph, uid, *field_names):
    for field_name in field_names:
        values = getattr(metagraph, field_name, None)
        if values is None:
            continue
        try:
            return scalar_float(values[uid])
        except (IndexError, KeyError, TypeError):
            continue
    return 0.0


def axon_at(metagraph, uid):
    axons = getattr(metagraph, 'axons', None)
    if axons is None:
        return None
    try:
        axon = axons[uid]
        ip = getattr(axon, 'ip', None)
        port = int(getattr(axon, 'port', 0) or 0)
        if ip in (None, 0, '0.0.0.0') or port == 0:
            return None
        if isinstance(ip, int):
            ip = str(ipaddress.ip_address(ip))
        return f'{ip}:{port}'
    except (IndexError, KeyError, TypeError, ValueError):
        return None

try:
    import bittensor as bt

    network = "finney"
    netuid = 71

    subtensor = bt.Subtensor(network=network)
    metagraph = subtensor.metagraph(netuid=netuid)

    # Get subnet info for alpha price
    try:
        subnet_info = subtensor.subnet(netuid=netuid)
        alpha_price = float(subnet_info.price) if hasattr(subnet_info, 'price') else None
    except Exception:
        alpha_price = None

    hotkey_to_uid = {}
    uid_to_hotkey = {}
    hotkey_to_coldkey = {}
    coldkey_to_hotkeys = {}
    incentives = {}
    emissions = {}
    stakes = {}
    is_validator = {}
    active = {}
    names = {}
    ranks = {}
    trusts = {}
    validator_trusts = {}
    consensus = {}
    dividends = {}
    axons = {}
    last_updates = {}

    # A synced metagraph normally carries the block it was read at. Fall back
    # to the current chain block on Bittensor versions that omit that field.
    current_block = optional_nonnegative_int(getattr(metagraph, 'block', None))
    if current_block is None:
        try:
            current_block = optional_nonnegative_int(subtensor.get_current_block())
        except Exception:
            current_block = None

    metagraph_last_updates = getattr(metagraph, 'last_update', None)

    n_neurons = metagraph.n if isinstance(metagraph.n, int) else metagraph.n.item() if hasattr(metagraph.n, 'item') else int(metagraph.n)

    for uid in range(n_neurons):
        hotkey = metagraph.hotkeys[uid]
        coldkey = metagraph.coldkeys[uid]

        hotkey_to_uid[hotkey] = uid
        uid_to_hotkey[uid] = hotkey
        hotkey_to_coldkey[hotkey] = coldkey

        # Group hotkeys by coldkey
        if coldkey not in coldkey_to_hotkeys:
            coldkey_to_hotkeys[coldkey] = []
        coldkey_to_hotkeys[coldkey].append(hotkey)

        # Get incentive (normalized 0-1)
        if hasattr(metagraph, 'incentive'):
            incentive_val = metagraph.incentive[uid]
            incentive_val = incentive_val.item() if hasattr(incentive_val, 'item') else float(incentive_val)
        elif hasattr(metagraph, 'I'):
            incentive_val = metagraph.I[uid]
            incentive_val = incentive_val.item() if hasattr(incentive_val, 'item') else float(incentive_val)
        else:
            incentive_val = 0.0
        incentives[hotkey] = incentive_val

        # Get emission (actual TAO emission)
        if hasattr(metagraph, 'emission'):
            emission_val = metagraph.emission[uid]
            emission_val = emission_val.item() if hasattr(emission_val, 'item') else float(emission_val)
        elif hasattr(metagraph, 'E'):
            emission_val = metagraph.E[uid]
            emission_val = emission_val.item() if hasattr(emission_val, 'item') else float(emission_val)
        else:
            emission_val = 0.0
        emissions[hotkey] = emission_val

        # Stake weight shown by metagraph explorers. `total_stake` includes
        # subnet alpha plus root stake converted at the network weighting.
        if hasattr(metagraph, 'total_stake'):
            stake_val = metagraph.total_stake[uid]
            stake_val = stake_val.item() if hasattr(stake_val, 'item') else float(stake_val)
        elif hasattr(metagraph, 'alpha_stake'):
            stake_val = metagraph.alpha_stake[uid]
            stake_val = stake_val.item() if hasattr(stake_val, 'item') else float(stake_val)
        elif hasattr(metagraph, 'stake'):
            stake_val = metagraph.stake[uid]
            stake_val = stake_val.item() if hasattr(stake_val, 'item') else float(stake_val)
        elif hasattr(metagraph, 'S'):
            stake_val = metagraph.S[uid]
            stake_val = stake_val.item() if hasattr(stake_val, 'item') else float(stake_val)
        else:
            stake_val = 0.0
        stakes[hotkey] = stake_val

        # Check if validator
        if hasattr(metagraph, 'validator_permit'):
            is_val = metagraph.validator_permit[uid]
            is_val = is_val.item() if hasattr(is_val, 'item') else bool(is_val)
        else:
            is_val = False
        is_validator[hotkey] = is_val
        active_values = getattr(metagraph, 'active', None)
        try:
            active[hotkey] = bool(active_values[uid].item() if hasattr(active_values[uid], 'item') else active_values[uid]) if active_values is not None else True
        except (IndexError, KeyError, TypeError):
            active[hotkey] = True
        ranks[hotkey] = metric_at(metagraph, uid, 'rank', 'R')
        trusts[hotkey] = metric_at(metagraph, uid, 'trust', 'T')
        validator_trusts[hotkey] = metric_at(metagraph, uid, 'validator_trust', 'Tv')
        consensus[hotkey] = metric_at(metagraph, uid, 'consensus', 'C')
        dividends[hotkey] = metric_at(metagraph, uid, 'dividends', 'D')
        axons[hotkey] = axon_at(metagraph, uid)

        # Older Bittensor releases may expose last_update only on each neuron.
        last_update = None
        if metagraph_last_updates is not None:
            try:
                last_update = optional_nonnegative_int(metagraph_last_updates[uid])
            except (IndexError, KeyError, TypeError):
                pass
        if last_update is None and hasattr(metagraph, 'neurons'):
            try:
                last_update = optional_nonnegative_int(getattr(metagraph.neurons[uid], 'last_update', None))
            except (IndexError, KeyError, TypeError):
                pass
        if last_update is not None:
            last_updates[hotkey] = last_update

    result = {
        'hotkeyToUid': hotkey_to_uid,
        'uidToHotkey': uid_to_hotkey,
        'hotkeyToColdkey': hotkey_to_coldkey,
        'coldkeyToHotkeys': coldkey_to_hotkeys,
        'incentives': incentives,
        'emissions': emissions,
        'stakes': stakes,
        'isValidator': is_validator,
        'active': active,
        'names': names,
        'ranks': ranks,
        'trusts': trusts,
        'validatorTrusts': validator_trusts,
        'consensus': consensus,
        'dividends': dividends,
        'axons': axons,
        'lastUpdates': last_updates,
        'currentBlock': current_block,
        'totalNeurons': n_neurons,
        'alphaPrice': alpha_price,
        'error': None
    }
    print(json.dumps(result))

except Exception as e:
    result = {
        'hotkeyToUid': {},
        'uidToHotkey': {},
        'hotkeyToColdkey': {},
        'coldkeyToHotkeys': {},
        'incentives': {},
        'emissions': {},
        'stakes': {},
        'isValidator': {},
        'active': {},
        'names': {},
        'ranks': {},
        'trusts': {},
        'validatorTrusts': {},
        'consensus': {},
        'dividends': {},
        'axons': {},
        'lastUpdates': {},
        'currentBlock': None,
        'totalNeurons': 0,
        'alphaPrice': None,
        'error': str(e)
    }
    print(json.dumps(result))
