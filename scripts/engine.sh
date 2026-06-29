#!/usr/bin/env bash
#
# engine.sh — the email outbound SENDING PORTAL from the CLI.
#
# Peter drives sending from the terminal, not the dashboard. This wraps the raw curl calls into
# clean subcommands. READ commands are safe to run anytime. WRITE commands (generate/send/recycle/
# autopilot/loop) hit LIVE infra — real Apollo credits, real Instantly sends — and PROMPT before firing.
#
# Config (reads ./.env automatically, or override via env):
#   BASE_URL      default https://peter-engine-working-copy.vercel.app
#   CRON_SECRET   bearer for loop/generate/send/optimize/grade endpoints
#   SNAPSHOT_KEY  key for the read-only snapshot
#   WORKSPACE_ID  optional; defaults to the single workspace server-side
#
# Usage:  bash scripts/engine.sh <command> [args]
# Run with no command (or `help`) to list everything.

set -euo pipefail
cd "$(dirname "$0")/.."

# --- load .env (only the vars we need; ignores the rest) ---
if [[ -f .env ]]; then
  for k in BASE_URL CRON_SECRET SNAPSHOT_KEY WORKSPACE_ID NEXTAUTH_URL; do
    v=$(grep -E "^${k}=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' || true)
    [[ -n "${v:-}" && -z "${!k:-}" ]] && export "$k=$v"
  done
fi
BASE_URL="${BASE_URL:-${NEXTAUTH_URL:-https://peter-engine-working-copy.vercel.app}}"
BASE_URL="${BASE_URL%/}"

_auth() { [[ -n "${CRON_SECRET:-}" ]] || { echo "ERROR: CRON_SECRET not set (add to .env)"; exit 1; }; }
_ws() { [[ -n "${WORKSPACE_ID:-}" ]] && echo "$WORKSPACE_ID" || echo ""; }
_confirm() {
  echo "⚠️  This hits LIVE infra: $1"
  read -r -p "    Type 'yes' to proceed: " ans
  [[ "$ans" == "yes" ]] || { echo "aborted."; exit 1; }
}
_get()  { curl -sS -X GET  "$1" -H "Authorization: Bearer ${CRON_SECRET:-}" "${@:2}" | jq . 2>/dev/null || true; }
_post() { curl -sS -X POST "$1" -H "Authorization: Bearer ${CRON_SECRET:-}" -H "Content-Type: application/json" "${@:2}" | jq . 2>/dev/null || true; }

cmd="${1:-help}"; shift || true

case "$cmd" in
  # ---------- READ (safe) ----------
  open|launch)   # open the one-button Launch page in your browser
    url="$BASE_URL/launch"
    echo "Opening $url"
    (open "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || echo "Go to: $url") ;;

  status|snapshot)
    [[ -n "${SNAPSHOT_KEY:-}" ]] || { echo "ERROR: SNAPSHOT_KEY not set"; exit 1; }
    # The at-a-glance health: sends, positives, deliverability verdict, winning style.
    _get "$BASE_URL/api/snapshot?key=$SNAPSHOT_KEY" ;;

  target|goal)   # the reply-rate war room: current rate, gap to 2%, the ONE binding constraint, levers
    # read-only — uses SNAPSHOT_KEY (same as status) so it works without CRON_SECRET
    [[ -n "${SNAPSHOT_KEY:-}" ]] || { echo "ERROR: SNAPSHOT_KEY not set"; exit 1; }
    curl -sS "$BASE_URL/api/target?key=$SNAPSHOT_KEY$([[ -n "$(_ws)" ]] && echo "&workspaceId=$(_ws)")" | jq . 2>/dev/null || true ;;

  grade)   # are the emails good? grades the existing pool. args: [limit] [batchId]
    _auth
    q="?limit=${1:-200}"; [[ -n "${2:-}" ]] && q="$q&batchId=$2"; [[ -n "$(_ws)" ]] && q="$q&workspaceId=$(_ws)"
    _get "$BASE_URL/api/leads/grade$q" ;;

  deliverability|inbox)   # CONFIRM deliverability: inbox placement + SPF/DKIM/DMARC per domain → one verdict
    [[ -n "${SNAPSHOT_KEY:-}" ]] || { echo "ERROR: SNAPSHOT_KEY not set"; exit 1; }
    curl -sS --max-time 90 "$BASE_URL/api/instantly/deliverability?key=$SNAPSHOT_KEY$([[ -n "$(_ws)" ]] && echo "&workspaceId=$(_ws)")" | jq . 2>/dev/null || true ;;

  styles)   # the style factory. subcommands: (none)=list | propose | approve <id> | reject <id>
    _auth
    sub="${1:-list}"
    case "$sub" in
      list)    _get "$BASE_URL/api/styles$([[ -n "$(_ws)" ]] && echo "?workspaceId=$(_ws)")" ;;
      propose) _confirm "propose NEW candidate styles (Claude spend; does NOT send — stays pending review)"
               _post "$BASE_URL/api/styles/propose" -d "{}" ;;
      approve) [[ -n "${2:-}" ]] || { echo "usage: engine.sh styles approve <id>"; exit 1; }
               _post "$BASE_URL/api/styles/approve" -d "{\"id\":\"$2\",\"action\":\"approve\"$([[ -n "$(_ws)" ]] && echo ",\"workspaceId\":\"$(_ws)\"")}" ;;
      reject)  [[ -n "${2:-}" ]] || { echo "usage: engine.sh styles reject <id>"; exit 1; }
               _post "$BASE_URL/api/styles/approve" -d "{\"id\":\"$2\",\"action\":\"reject\"$([[ -n "$(_ws)" ]] && echo ",\"workspaceId\":\"$(_ws)\"")}" ;;
      *) echo "usage: engine.sh styles [list|propose|approve <id>|reject <id>]" ;;
    esac ;;

  # ---------- WRITE (live — prompts) ----------
  generate)   # generate sequences for a batch. args: <batchId>
    _auth; [[ -n "${1:-}" ]] || { echo "usage: engine.sh generate <batchId>"; exit 1; }
    _confirm "generate email sequences (Claude spend)"
    _post "$BASE_URL/api/leads/generate" -d "{\"batchId\":\"$1\",\"useFastModel\":true$([[ -n "$(_ws)" ]] && echo ",\"workspaceId\":\"$(_ws)\"")}" ;;

  recycle)    # re-draft all prior unsent/never-replied leads in the current default style
    _auth
    _confirm "RECYCLE — re-draft the prior lead pool (Claude spend; does NOT send)"
    _post "$BASE_URL/api/leads/generate" -d "{\"recycle\":true,\"useFastModel\":true$([[ -n "$(_ws)" ]] && echo ",\"workspaceId\":\"$(_ws)\"")}" ;;

  hit-oldest)  # re-draft the OLDEST never-recycled leads in a hard-hitting style + optimized subjects. arg: <style> (default direct-incentive)
    _auth
    style="${1:-direct-incentive}"
    _confirm "HIT-OLDEST — re-draft oldest never-touched leads in '$style' with optimized subjects (Claude spend; does NOT send)"
    _post "$BASE_URL/api/leads/generate" -d "{\"recycle\":true,\"neverRecycledOnly\":true,\"oldestFirst\":true,\"optimizeSubject\":true,\"style\":\"$style\",\"useFastModel\":true$([[ -n "$(_ws)" ]] && echo ",\"workspaceId\":\"$(_ws)\"")}" ;;

  hit-icp)     # like hit-oldest but ONLY right-fit ICP personas (the converters). args: <style> [cooldownDays]
    _auth
    style="${1:-direct-incentive}"; cd_days="${2:-10}"
    _confirm "HIT-ICP — re-draft right-fit ICP leads (consumer-insights/brand/marketing/growth) sent >${cd_days}d ago in '$style' + optimized subjects (Claude spend; does NOT send)"
    _post "$BASE_URL/api/leads/generate" -d "{\"recycle\":true,\"oldestFirst\":true,\"optimizeSubject\":true,\"cooldownDays\":$cd_days,\"style\":\"$style\",\"personas\":[\"consumer-insights\",\"brand-social\",\"product-marketing\",\"growth-general\"],\"useFastModel\":true$([[ -n "$(_ws)" ]] && echo ",\"workspaceId\":\"$(_ws)\"")}" ;;

  send)       # upload + activate a batch in Instantly. args: <batchId> [sendLimit]
    _auth; [[ -n "${1:-}" ]] || { echo "usage: engine.sh send <batchId> [sendLimit]"; exit 1; }
    _confirm "SEND real cold emails via Instantly (batch $1, limit ${2:-100})"
    _post "$BASE_URL/api/instantly/send" -d "{\"batchId\":\"$1\",\"skipFailingLeads\":true,\"sendLimit\":${2:-100}$([[ -n "$(_ws)" ]] && echo ",\"workspaceId\":\"$(_ws)\"")}" ;;

  send-good)   # SEND N good emails of various proven styles (grade-checked, ICP, exact batch). args: [count] [provider]
    _auth
    [[ -n "$(_ws)" ]] || { echo "ERROR: WORKSPACE_ID required in .env"; exit 1; }
    n="${1:-200}"; prov="${2:-no-gateways}"
    _confirm "SEND-GOOD — send $n grade-checked good emails (various styles, ICP, provider=$prov) — REAL sends"
    curl -sS -X POST "$BASE_URL/api/send-batch" -H "x-cron-secret: ${CRON_SECRET}" -H "Content-Type: application/json" \
      -d "{\"count\":$n,\"providerFilter\":\"$prov\",\"workspaceId\":\"$(_ws)\"}" | jq . 2>/dev/null || true ;;

  send-recycle)  # SEND drafted recycle leads of a given style (pairs with hit-oldest/hit-icp). args: [style] [sendLimit]
    _auth
    [[ -n "$(_ws)" ]] || { echo "ERROR: WORKSPACE_ID required in .env for send-recycle"; exit 1; }
    style="${1:-direct-incentive}"; lim="${2:-300}"; cd_days="${3:-10}"
    _confirm "SEND-RECYCLE — ship drafted '$style' recycle leads via Instantly (REAL sends, limit $lim, cooldown ${cd_days}d)"
    curl -sS -X POST "$BASE_URL/api/incentives/launch" -H "x-cron-secret: ${CRON_SECRET}" -H "Content-Type: application/json" \
      -d "{\"recycle\":true,\"useGeneratedSteps\":true,\"recycleStyle\":\"$style\",\"cooldownDays\":$cd_days,\"sendLimit\":$lim,\"workspaceId\":\"$(_ws)\"}" | jq . 2>/dev/null || true ;;

  retarget-ooo)  # SEND the money offer to OOO leads who are now back (run AFTER July 4). args: [sendLimit]
    _auth
    [[ -n "$(_ws)" ]] || { echo "ERROR: WORKSPACE_ID required in .env for retarget-ooo"; exit 1; }
    lim="${1:-300}"
    _confirm "RETARGET-OOO — re-contact out-of-office leads who are back, with the incentive offer (REAL sends, limit $lim)"
    curl -sS -X POST "$BASE_URL/api/incentives/launch" -H "x-cron-secret: ${CRON_SECRET}" -H "Content-Type: application/json" \
      -d "{\"oooRequeue\":true,\"sendLimit\":$lim,\"workspaceId\":\"$(_ws)\"}" | jq . 2>/dev/null || true ;;

  autopilot)  # one generate+send autopilot pass for the workspace
    _auth
    _confirm "AUTOPILOT — generate + SEND in one pass (real sends)"
    _get "$BASE_URL/api/orchestrate/run" ;;

  loop)       # run the whole daily loop by hand (analytics → ingest → optimize → mine → research → evaluate; includes send)
    _auth
    _confirm "DAILY LOOP — analytics + ingest + optimize + mine-replies + research-experiments + autopilot SEND"
    _get "$BASE_URL/api/cron/analytics" ;;

  # ---------- loop sub-steps (no send; safe-ish, still live reads/writes to DB) ----------
  mine-replies)        _auth; _get "$BASE_URL/api/optimize/mine-replies" ;;        # replies → learnings
  research)            _auth; _get "$BASE_URL/api/optimize/research-experiments" ;; # web research → A/B variants
  evaluate)            _auth; _get "$BASE_URL/api/optimize/variants/evaluate" ;;    # promote/kill variants
  optimize)            _auth; _get "$BASE_URL/api/optimize/iterate" ;;              # deliverability guardrail + style/incentive rating

  help|*)
    cat <<'EOF'
engine.sh — email sending portal (CLI)

READ (safe):
  target            ⮕ START HERE: current reply rate, gap to 2%, the ONE thing to fix now
  status            at-a-glance health: sends, positives, deliverability verdict, winning style
  grade [N] [batch] grade the existing pool's emails (are they good?), top N (default 200)
  deliverability    CONFIRM inbox placement + SPF/DKIM/DMARC per domain → one verdict
  styles            list proposed + approved styles (grades + live reply rate)

STYLE FACTORY:
  styles propose        draft new candidate styles, self-graded (no send; awaits your approval)
  styles approve <id>   put an approved style into the generation rotation
  styles reject <id>    discard a proposed style

WRITE (live infra — prompts before firing):
  generate <batch>  draft sequences for a batch (Claude spend)
  recycle           re-draft the whole prior unsent pool (Claude spend; no send)
  hit-oldest [style] re-draft OLDEST never-touched leads, hard-hitting style + optimized subjects
  send-good [N] [prov]  ⮕ SEND N grade-checked good emails of various styles (ICP; REAL sends)
  send <batch> [N]  upload + activate a batch in Instantly (REAL sends)
  send-recycle [style] [N]  SEND the drafted recycle leads of a style (REAL sends; pairs with hit-oldest/hit-icp)
  retarget-ooo [N]  SEND the offer to OOO leads who are back (run AFTER July 4th)
  autopilot         one generate+send pass
  loop              run the full daily loop by hand (includes send)

LOOP STEPS (live, no send):
  mine-replies      mine reply text into learnings
  research          turn web research into personalized A/B variants
  evaluate          promote/kill experiment variants (Wilson)
  optimize          deliverability guardrail + style/incentive outcome rating

Config comes from ./.env (BASE_URL, CRON_SECRET, SNAPSHOT_KEY, WORKSPACE_ID).
Full map: see SENDING.md.
EOF
    ;;
esac
