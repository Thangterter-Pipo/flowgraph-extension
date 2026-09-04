from pathlib import Path
root = Path(r'E:\Flow_veo')
css = (root / '_ctl' / 'production_v3.css').read_text(encoding='utf-8')
target = root / 'flowgraph-extension' / 'src' / 'ui' / 'theme.css'
text = target.read_text(encoding='utf-8')
marker = '/* Film Production V3 */'
if marker not in text:
    target.write_text(text.rstrip() + '\n' + css + '\n', encoding='utf-8')
