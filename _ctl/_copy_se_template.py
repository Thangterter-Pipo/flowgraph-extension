import shutil, os
src=r'C:\Users\thang\Downloads\CAPSTONE_TEMPLATE_2026\PROPOSAL_TEMPLATE\2026 -SE_Capstone_Proposal_Template.docx'
dst=r'E:\Flow_veo\_ctl\SE_Capstone_Proposal_Template.docx'
shutil.copy2(src,dst)
print(dst, os.path.getsize(dst))
