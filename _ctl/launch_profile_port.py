import subprocess, sys
profile=sys.argv[1]
port=sys.argv[2]
chrome=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
extension=r"E:\Flow_veo\flowgraph-extension\dist"
url="https://labs.google/fx/tools/flow"
args=[chrome,f"--remote-debugging-port={port}",f"--user-data-dir={profile}",f"--load-extension={extension}","--no-first-run","--no-default-browser-check",url]
p=subprocess.Popen(args)
print(p.pid, flush=True)
