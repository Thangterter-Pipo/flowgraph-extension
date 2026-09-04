from pathlib import Path

root = Path(r"E:\Flow_veo")
theme = root / "flowgraph-extension/src/ui/theme.css"
fragment = (root / "_ctl/timeline_v2.css").read_text(encoding="utf-8")
text = theme.read_text(encoding="utf-8")
marker = "/* Professional Timeline V2 */"
if marker in text:
    text = text.split(marker, 1)[0].rstrip() + "\n"
theme.write_text(text + fragment, encoding="utf-8")
