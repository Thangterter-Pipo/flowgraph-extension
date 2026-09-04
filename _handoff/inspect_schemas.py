import json, glob, os
for f in sorted(glob.glob(r'E:\\Google-flow-skills\\schemas\\*.schema.json')):
    data=json.load(open(f,encoding='utf-8'))
    print(os.path.basename(f), ':', ', '.join(data.get('properties',{}).keys()))
