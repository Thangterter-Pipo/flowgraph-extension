from pathlib import Path

target = Path(r'E:\Flow_veo\flowgraph-extension\src\ui\theme.css')
source = Path(r'E:\Flow_veo\_ctl\continuity_v4.css')
marker = '/* Film Production V4: continuity, structure, dependencies and preflight */'
text = target.read_text(encoding='utf-8')
css = source.read_text(encoding='utf-8')
if marker not in text:
    target.write_text(text + '\n' + css, encoding='utf-8')
    print('APPENDED', len(css))
else:
    print('ALREADY_PRESENT')
