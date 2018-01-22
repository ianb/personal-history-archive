#!/usr/bin/env python3
"""
Usage: use at the shell, like:

  $ npm run for-each -- -j login examples/haslogin.py
"""


import json
import os

page_data = json.load(open(os.environ['PAGE_JSON_FILE']))

if 'type="password"' in page_data['body']:
    print(json.dumps({"command": "annotate", "name": "hasPassword", "value": True}))
