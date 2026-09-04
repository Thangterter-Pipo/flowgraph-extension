import subprocess, sys
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
profile = sys.argv[1]
port = sys.argv[2]
url = sys.argv[3]
extension = r"E:\Flow_veo\flowgraph-extension\dist"
subprocess.Popen([chrome, f"--remote-debugging-port={port}", f"--user-data-dir={profile}", f"--load-extension={extension}", "--no-first-run", "--no-default-browser-check", url])
