#!/usr/bin/env python3
"""Mac/human operator entry point. Preparation defaults to read-only dry-run."""
import argparse
import json
import re
import subprocess
import sys
from etapi import ETAPI, Refused, credential, validate_url
from fixture import Fixture
from package import ROOT
from reconcile import plan, execute


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], stderr=subprocess.DEVNULL, text=True).strip()


def approved_source(commit, tree):
    if not re.fullmatch(r"[0-9a-f]{40}", commit or "") or not re.fullmatch(r"[0-9a-f]{40}", tree or ""):
        raise Refused("Mutation requires exact approved commit and tree IDs")
    if git("rev-parse", "HEAD") != commit or git("rev-parse", "HEAD^{tree}") != tree:
        raise Refused("Checkout does not match approved source")
    if git("status", "--porcelain", "--untracked-files=all"):
        raise Refused("Operator checkout must be clean")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("apply", "disable"))
    parser.add_argument("--fixture", action="store_true", help="deterministic in-memory rehearsal; no credential/network")
    parser.add_argument("--url", help="loopback origin of an already established private operator tunnel")
    parser.add_argument("--parent-note-id", help="existing unique note ID verified by operator in the intended Lore instance")
    parser.add_argument("--execute", action="store_true", help="perform the reviewed action; requires separate exact-artifact approval")
    parser.add_argument("--approved-commit")
    parser.add_argument("--approved-tree")
    args = parser.parse_args()
    if args.fixture:
        if args.execute or args.url or args.parent_note_id:
            raise Refused("Fixture mode cannot select a live target or execute live writes")
        api = Fixture()
        first = execute(api, plan(api, "fixtureParent", "apply"))
        second = execute(api, plan(api, "fixtureParent", "apply"))
        disabled = execute(api, plan(api, "fixtureParent", "disable"))
        repeated_disable = execute(api, plan(api, "fixtureParent", "disable"))
        print(json.dumps(dict(fixture=True, first=first, second=second, disable=disabled,
                              repeated_disable=repeated_disable), sort_keys=True))
        return
    if not args.url or not args.parent_note_id:
        raise Refused("Live dry-run requires loopback URL and verified unique parent note ID")
    validate_url(args.url)
    if args.execute:
        approved_source(args.approved_commit, args.approved_tree)
    api = ETAPI(args.url, credential())
    operations = plan(api, args.parent_note_id, args.mode)
    result = execute(api, operations) if args.execute else dict(operations=len(operations),
             created=sum(path == "/create-note" for _, path, _, _ in operations))
    if args.execute and plan(api, args.parent_note_id, args.mode):
        raise Refused("Post-apply reconciliation not empty; inspect target and do not claim success")
    print(json.dumps(dict(mode=args.mode, dry_run=not args.execute, source_commit=git("rev-parse", "HEAD"),
                          source_tree=git("rev-parse", "HEAD^{tree}"), **result), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (Refused, OSError, ValueError, KeyError, AssertionError, subprocess.SubprocessError) as error:
        # Never render arbitrary exception text: upstream content/paths may be sensitive.
        message = str(error) if isinstance(error, Refused) else "Local validation failed; details withheld"
        print("THG Sublime refused: " + message, file=sys.stderr)
        sys.exit(1)
