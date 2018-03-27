"""Simple script for substituting environmental variables in a template-ish file"""

import re
import sys
import os
import json

env_re = re.compile(r'process\.env\.([a-zA-Z0-9_]+)')


def matcher(m):
    value = os.environ.get(m.group(1)) or ""
    return json.dumps(value)


input = sys.stdin.read()
output = env_re.sub(matcher, input)

sys.stdout.write(output)
