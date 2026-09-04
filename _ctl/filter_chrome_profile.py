from pathlib import Path
p = Path(r"E:\Flow_veo\_ctl\chrome_procs.txt")
s = p.read_text(encoding="utf-16", errors="ignore")
for line in s.splitlines():
    if "chrome-profile" in line.lower():
        print(line)
