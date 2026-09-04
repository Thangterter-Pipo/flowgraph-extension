import os, json
base=r'C:\Users\thang\Downloads\CAPSTONE_TEMPLATE_2026'
target=os.path.join(base,'PROPOSAL_TEMPLATE')
print(json.dumps({'base_exists':os.path.exists(base),'target_exists':os.path.exists(target),'target_isdir':os.path.isdir(target),'target_isfile':os.path.isfile(target)},ensure_ascii=False))
if os.path.exists(base):
    for root, dirs, files in os.walk(base):
        depth=root[len(base):].count(os.sep)
        if depth>2:
            dirs[:] = []
            continue
        for name in files:
            print(os.path.join(root,name))
        for name in dirs:
            print(os.path.join(root,name)+os.sep)
