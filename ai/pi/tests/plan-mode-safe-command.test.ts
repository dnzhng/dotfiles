import { describe, expect, test } from "bun:test";
import { isSafeCommand } from "../extensions/plan-mode/utils.ts";

describe("isSafeCommand", () => {
	test.each([
		"git -C /Users/danzhang/Code/carrot log --oneline -1",
		"cd ~/Code/carrot 2>/dev/null || cd ~/carrot; gh pr view 1 --json title -q '.title'",
		"cd /x && git log --oneline -1 && git status -sb | head -3; ls foo/ 2>&1",
		'cd d && for f in c/*.yaml; do echo "=== $f"; cat $f; done',
		'gh pr diff 1 > /tmp/a.diff; wc -l /tmp/a.diff; grep -n "a\\|b" /tmp/a.diff | head',
		'ls *.jsonl | while read f; do grep -c x "$f"; done',
		"if [ -f file ]; then cat file; fi",
		"jq '.a | .b' f",
		'echo "$(git rev-parse HEAD)"',
		"find . -name x -exec grep foo {} \\;",
		"[ -f file ] && cat file",
		'printf "%s\\n" a b',
		'[ -n "$x" ] && cat f',
		"echo \"$(git log --format='%h' -1)\"",
		"cat <<<x",
		"ls ~/sessions/--Users-danzhang-Code-dotfiles--/",
	])("allows read-only command: %s", (command) => {
		expect(isSafeCommand(command)).toBe(true);
	});

	test.each([
		"ls; python evil.py",
		"cat x && rm y",
		"ls | xargs rm",
		"echo $(touch x)",
		"cd x && npm install",
		"echo x > out.txt",
		"echo x > /tmp/../etc/x",
		"echo x >> ~/f",
		"code .",
		"/bin/rm x",
		"for f in *; do python $f; done",
		"echo 'x\\' ; python evil.py #'",
		"'python3' 'evil.py'",
		"echo x > /tmp/.''./etc/x",
		"echo x > /tmp/.$(printf %s /../../etc/x)",
		"env /bin/rm -rf x",
		"find . -exec /bin/rm {} \\;",
		"awk 'BEGIN{system(\"/bin/rm x\")}'",
		"for x in '$(python3 evil.py)'; do echo ${x@P}; done",
		"for x in 'a[$(python3 e)]'; do echo ${!x}; done",
		"for cat in 'a[$(python3 e)]'; do echo $((cat)); done",
		"for cat in 'a[$(python3 e)]'; do echo $[cat]; done",
		"for cat in 'a[$(python3 e)]'; do echo ${x:cat}; done",
		"[ -v 'a[$(python3 e)]' ]",
		"[ '-v' 'a[$(python3 e)]' ]",
		"[ \\-v 'a[$(python3 e)]' ]",
		"[ -n x -a -v 'a[$(python3 e)]' ]",
		"[ ! ! -v 'a[$(python3 e)]' ]",
		"printf -v 'a[$(python3 e)]' %s x",
		"printf -v'a[$(python3 e)]' %s x",
		"printf $'-v' 'a[$(python3 e)]' x",
		"[ $'-v' 'a[$(python3 e)]' ]",
		"[ -${x:-v} 'a[$(python3 e)]' ]",
		"read 'a[$(python3 e)]' </dev/null",
		"echo x | read 'a[$(python3 e)]'",
		"read 'a[$(python3 e)]' <<< x",
		"test/run.sh",
		"echo $'\\'' ; python3 evil.py ; echo $'\\''",
		'echo "' + String.fromCharCode(92) + "\nls \" ; python3 evil.py ; echo \"\"", 
		'echo "$(echo "x"; python3 e)"',
		'echo "`echo "x";python3 e`"',
		"cat <<cat\necho '\ncat\npython3 evil.py\ncat <<cat\n'\ncat",
		"ls # '\npython3 evil.py\n# '",
		"",
	])("blocks unsafe command: %s", (command) => {
		expect(isSafeCommand(command)).toBe(false);
	});
});
