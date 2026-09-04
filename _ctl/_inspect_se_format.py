from docx import Document
from docx.shared import Cm
p=r'E:\Flow_veo\_ctl\SE_Capstone_Proposal_Template.docx'
d=Document(p)
s=d.sections[0]
print('margins_cm',s.top_margin.cm,s.bottom_margin.cm,s.left_margin.cm,s.right_margin.cm)
for name in ['Normal','Title','Heading 1','Heading 2']:
    st=d.styles[name]
    print(name,'font',st.font.name,'size',st.font.size.pt if st.font.size else None,'bold',st.font.bold,'italic',st.font.italic)
    pf=st.paragraph_format
    print('  spacing',pf.line_spacing,'before',pf.space_before.pt if pf.space_before else None,'after',pf.space_after.pt if pf.space_after else None)
