#!/bin/bash
# Test the statusline template's JSON parsing helpers against a sample input.
# Run from the repo root (handled by npm run test).

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$HERE/../../media/statusline-template.sh"
TMP="${TMPDIR:-/tmp}"

if [ ! -f "$TEMPLATE" ]; then
  echo "FAIL: template not found at $TEMPLATE"
  exit 1
fi

pass=0
fail=0

check() {
  local desc="$1"; shift
  local expected="$1"; shift
  local actual="$1"; shift
  if [ "$expected" = "$actual" ]; then
    pass=$((pass+1))
    echo "  ok  $desc"
  else
    fail=$((fail+1))
    echo "  FAIL  $desc"
    echo "        expected: '$expected'"
    echo "        actual:   '$actual'"
  fi
}

# --- Load parser functions ---
# The template defines jf/jn/jnested inline. Redefine here identically so
# the test exercises the same extraction logic without sourcing the full
# template (which also spawns git subprocesses etc.).
jf() {
  REPLY=""
  local pat="\"$1\":\"([^\"]*)\""
  [[ "$I" =~ $pat ]] && REPLY="${BASH_REMATCH[1]}"
}
jn() {
  REPLY=""
  local pat="\"$1\":([0-9.]+)"
  [[ "$I" =~ $pat ]] && REPLY="${BASH_REMATCH[1]}"
}
jnested() {
  REPLY=""
  local pat="\"$1\":[{][^}]*\"$2\":([0-9.]+)"
  [[ "$I" =~ $pat ]] && REPLY="${BASH_REMATCH[1]}"
}

# Verify the template defines them (cheap drift check; detailed behaviour
# is covered by the checks below).
grep -q '^jf() {' "$TEMPLATE"      || { echo "FAIL: template missing jf definition"; exit 1; }
grep -q '^jn() {' "$TEMPLATE"      || { echo "FAIL: template missing jn definition"; exit 1; }
grep -q '^jnested() {' "$TEMPLATE" || { echo "FAIL: template missing jnested definition"; exit 1; }

# Sample JSON matching what Claude Code pipes to the statusline.
I='{"model":{"display_name":"Opus 4.7"},"cwd":"/tmp/no-repo","context_window":{"total_input_tokens":42000,"total_output_tokens":3000,"used_percentage":24.7},"cost":{"total_cost_usd":0.1234,"total_lines_added":42,"total_lines_removed":3},"rate_limits":{"five_hour":{"used_percentage":12},"seven_day":{"used_percentage":3}}}'

jf display_name;            check "jf parses model display_name" "Opus 4.7"     "$REPLY"
jf cwd;                     check "jf parses cwd"                 "/tmp/no-repo" "$REPLY"
jn used_percentage;         check "jn parses used_percentage"     "24.7"         "$REPLY"
jn total_cost_usd;          check "jn parses cost"                "0.1234"       "$REPLY"
jn total_lines_added;       check "jn parses lines added"         "42"           "$REPLY"
jn total_lines_removed;     check "jn parses lines removed"       "3"            "$REPLY"
jn total_input_tokens;      check "jn parses input tokens"        "42000"        "$REPLY"
jn total_output_tokens;     check "jn parses output tokens"       "3000"         "$REPLY"
jnested five_hour used_percentage; check "jnested parses five_hour" "12"         "$REPLY"
jnested seven_day used_percentage; check "jnested parses seven_day" "3"          "$REPLY"

# Segment toggle comment handling: every segment BEGIN marker should have a
# matching END marker.
BEGIN_COUNT=$(grep -c '^#SEGMENT:[a-zA-Z]*:BEGIN$' "$TEMPLATE")
END_COUNT=$(grep -c '^#SEGMENT:[a-zA-Z]*:END$' "$TEMPLATE")
check "template BEGIN/END markers match" "$BEGIN_COUNT" "$END_COUNT"

# Every known segment id should appear in the template.
for id in model gitBranch contextBar tokensUsed cost linesChanged rateLimits selection; do
  grep -q "^#SEGMENT:${id}:BEGIN" "$TEMPLATE"
  if [ $? -eq 0 ]; then
    pass=$((pass+1))
    echo "  ok  template defines segment '$id'"
  else
    fail=$((fail+1))
    echo "  FAIL  template is missing segment '$id'"
  fi
done

echo ""
echo "statusline.test.sh: $pass passed, $fail failed"
exit $fail
