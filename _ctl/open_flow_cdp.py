import json
import urllib.parse
import urllib.request

url = 'https://labs.google/fx/tools/flow'
endpoint = 'http://127.0.0.1:9222/json/new?' + urllib.parse.quote(url, safe=':/?=&')
req = urllib.request.Request(endpoint, method='PUT')
with urllib.request.urlopen(req, timeout=10) as r:
    print(r.read().decode('utf-8', errors='replace'))
