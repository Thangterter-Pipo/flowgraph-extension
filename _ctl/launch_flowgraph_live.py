import subprocess
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
profile = r"E:\Flow_veo\chrome-profile-test"
extension = r"E:\Flow_veo\flowgraph-extension\dist"
url = "https://labs.google/fx/tools/flow/project/9125da34-52c4-4f38-a8cc-7d6e1bb31483"
args = [chrome,"--remote-debugging-port=9223",f"--user-data-dir={profile}",f"--load-extension={extension}","--no-first-run","--no-default-browser-check",url]
p = subprocess.Popen(args)
print(p.pid, flush=True)
