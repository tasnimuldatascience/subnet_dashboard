#!/usr/bin/env python3
"""Fetch metagraph data from Bittensor network"""

import json
import sys

try:
    import bittensor as bt

    network = "finney"
    netuid = 71

    subtensor = bt.Subtensor(network=network)
    metagraph = subtensor.metagraph(netuid=netuid)

    hotkey_to_uid = {}
    uid_to_hotkey = {}
    incentives = {}
    emissions = {}
    stakes = {}
    is_validator = {}

    n_neurons = metagraph.n if isinstance(metagraph.n, int) else metagraph.n.item() if hasattr(metagraph.n, 'item') else int(metagraph.n)

    for uid in range(n_neurons):
        hotkey = metagraph.hotkeys[uid]
        hotkey_to_uid[hotkey] = uid
        uid_to_hotkey[uid] = hotkey

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

        # Get alpha stake (subnet-specific stake)
        if hasattr(metagraph, 'alpha_stake'):
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

    result = {
        'hotkeyToUid': hotkey_to_uid,
        'uidToHotkey': uid_to_hotkey,
        'incentives': incentives,
        'emissions': emissions,
        'stakes': stakes,
        'isValidator': is_validator,
        'totalNeurons': n_neurons,
        'error': None
    }
    print(json.dumps(result))

except Exception as e:
    result = {
        'hotkeyToUid': {},
        'uidToHotkey': {},
        'incentives': {},
        'emissions': {},
        'stakes': {},
        'isValidator': {},
        'totalNeurons': 0,
        'error': str(e)
    }
    print(json.dumps(result))
