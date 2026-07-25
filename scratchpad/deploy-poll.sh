#!/usr/bin/env bash
# Poll Railway Web deployment for a given commit until terminal state.
WANT_COMMIT="${1:-}"
for i in $(seq 1 90); do
  OUT=$(railway deployment list --service Web --json 2>/dev/null | python3 -c "
import json,sys
want='$WANT_COMMIT'
try:
    arr=json.load(sys.stdin)
except Exception:
    print('NOJSON|'); sys.exit()
dep=None
if want:
    for d in arr:
        if (d.get('meta') or {}).get('commitHash','').startswith(want):
            dep=d; break
if dep is None and arr:
    dep=arr[0]
print((dep.get('status','NONE') if dep else 'NONE')+'|'+((dep.get('meta') or {}).get('commitHash','')[:7] if dep else ''))
")
  STATUS="${OUT%%|*}"; SHA="${OUT##*|}"
  echo "[$(date +%H:%M:%S)] attempt $i: $STATUS ($SHA)"
  case "$STATUS" in
    SUCCESS) echo "DEPLOY_OK"; exit 0 ;;
    FAILED|CRASHED|REMOVED) echo "DEPLOY_BAD"; exit 1 ;;
  esac
  sleep 20
done
echo "DEPLOY_TIMEOUT"; exit 2
