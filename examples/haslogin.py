#!/usr/bin/env python3

import json
import os

page_data = json.load(open(os.environ['PAGE_JSON_FILE']))

if 'type="password"' in page_data['body']:
    print(json.dumps({"action": "set-attr", "attr": "hasPassword", "value": True}))
