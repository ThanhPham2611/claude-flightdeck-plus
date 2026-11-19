#!/usr/bin/env python3
"""Imports the token usage from your past Claude Code sessions into Flightdeck Plus's token box.

The plugin counts every model response from the moment it first loads (it writes `liveFrom` into its
store then). This adds up what your session logs hold from before that moment, per local day, and saves
it as `history`, so the box's "tổng" and "cao nhất" cover everything you have used on this machine.

    python3 scripts/import-history.py            # import
    python3 scripts/import-history.py --dry-run  # only print what it would save
    python3 scripts/import-history.py --store PATH   # a store file the glob below does not find

Run it once after the plugin has loaded (open Claude Code with it installed first). Running it again is
safe: it overwrites `history`, never adds to it. Counts follow the plugin: fresh = input + cache writes,
out = output, cache = cache reads. A response that a resumed or forked session copied is counted once.
"""
import argparse, glob, json, os, sys
from datetime import datetime, timezone

CONFIG = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')


def find_store(arg):
    if arg:
        return arg
    found = sorted(glob.glob(os.path.join(CONFIG, 'plugins', 'store', 'flightdeck-plus_*.json')))
    # More than one (the plugin installed from two marketplaces): the one that has started counting.
    ready = [p for p in found if 'liveFrom' in json.load(open(p))]
    if not ready:
        sys.exit('No store with `liveFrom` under %s/plugins/store. Install Flightdeck Plus, open Claude Code '
                 'once with it, then run this again.' % CONFIG)
    return ready[0]


def scan(before):
    """Per-day {fresh, out, cache} of every response stamped before `before`, duplicates merged."""
    seen = {}  # (message id, request id) -> [timestamp, fresh, out, cache]
    for path in glob.glob(os.path.join(CONFIG, 'projects', '**', '*.jsonl'), recursive=True):
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                if '"usage"' not in line or '"assistant"' not in line:  # cheap filter before parsing
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                m = r.get('message')
                if r.get('type') != 'assistant' or not isinstance(m, dict) or m.get('model') == '<synthetic>':
                    continue
                u, ts = m.get('usage'), r.get('timestamp')
                if not isinstance(u, dict) or not ts:
                    continue
                row = [ts, (u.get('input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0),
                       u.get('output_tokens') or 0, u.get('cache_read_input_tokens') or 0]
                key = (m.get('id') or r.get('uuid'), r.get('requestId'))
                cur = seen.setdefault(key, row)
                if cur is not row:  # a streamed reply is logged in pieces: keep the largest of each kind
                    cur[1:] = [max(a, b) for a, b in zip(cur[1:], row[1:])]
                    cur[0] = min(cur[0], ts)
    days, n = {}, 0
    for ts, fresh, out, cache in seen.values():
        t = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        if t >= before:
            continue
        d = days.setdefault(t.astimezone().strftime('%Y-%m-%d'), {'fresh': 0, 'out': 0, 'cache': 0})
        d['fresh'] += fresh; d['out'] += out; d['cache'] += cache
        n += 1
    return dict(sorted(days.items())), n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--store')
    args = ap.parse_args()

    store = find_store(args.store)
    data = json.load(open(store))
    if 'liveFrom' not in data:
        sys.exit('%s has no `liveFrom`: open Claude Code with the plugin once, then run this again.' % store)
    before = datetime.fromisoformat(data['liveFrom'].replace('Z', '+00:00'))
    days, n = scan(before)
    if not days:
        sys.exit('No past usage found under %s/projects.' % CONFIG)

    total = {k: sum(d[k] for d in days.values()) for k in ('fresh', 'out', 'cache')}
    best = max(days.items(), key=lambda kv: sum(kv[1].values()))
    print('%d responses, %d days, from %s' % (n, len(days), next(iter(days))))
    print('total      %s = %s' % (total, f'{sum(total.values()):,}'))
    print('busiest    %s %s = %s' % (best[0], best[1], f'{sum(best[1].values()):,}'))
    if args.dry_run:
        print('(dry run: nothing written)')
        return

    data = json.load(open(store))  # read again just before writing: the plugin may have counted meanwhile
    data['history'] = {'days': days, 'before': data['liveFrom'], 'responses': n,
                       'scannedAt': datetime.now(timezone.utc).isoformat()}
    tmp = store + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, store)
    print('saved to', store, '. Send a message in Claude Code and the box updates.')


if __name__ == '__main__':
    main()
