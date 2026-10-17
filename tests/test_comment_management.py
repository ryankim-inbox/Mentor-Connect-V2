from uuid import uuid4
from backend_support import api,login


def test_author_comment_edit_delete_preserves_replies_and_never_replays_deleted_text(backend_server):
    with backend_server() as base:
        owner,_=login(base,'student001@test.edu')
        mentor,_=login(base,'mentor501@test.edu')
        status,req=api(owner,base,'POST','/api/requests',{'districtId':1,'role':'mentee','title':'Comments','description':'Local'})
        assert status==201
        path=f"/api/requests/{req['id']}/comments"
        body={'body':'secret original','clientCommentId':str(uuid4())}
        parent=api(mentor,base,'POST',path,body)[1]
        comment_path=path+f"/{parent['id']}"
        reply=api(owner,base,'POST',path,{'body':'reply stays','parentId':parent['id'],'clientCommentId':str(uuid4())})[1]
        assert api(owner,base,'PATCH',comment_path,{'body':'overwrite'})[0]==403
        assert api(owner,base,'DELETE',comment_path)[0]==403
        status,edited=api(mentor,base,'PATCH',comment_path,{'body':'edited secret'})
        assert status==200 and edited['updatedAt'] and edited['body']=='edited secret'
        status,deleted=api(mentor,base,'DELETE',comment_path)
        assert status==200 and deleted['body']=='' and deleted['deletedAt']
        assert api(mentor,base,'PATCH',comment_path,{'body':'resurrect'})[0]==409
        replay=api(mentor,base,'POST',path,body)
        assert replay[0] in (201,409)
        assert 'secret original' not in str(replay[1]) and 'edited secret' not in str(replay[1])
        comments=api(owner,base,'GET',path)[1]
        assert [c['id'] for c in comments]==[parent['id'],reply['id']]
        assert comments[0]['body']=='' and comments[1]['body']=='reply stays'
        assert api(mentor,base,'DELETE',comment_path)[1]==deleted


def test_comment_mutations_recheck_blocks_and_request_visibility(backend_server):
    with backend_server() as base:
        owner,_=login(base,'student001@test.edu')
        mentor,_=login(base,'mentor501@test.edu')
        req=api(owner,base,'POST','/api/requests',{'districtId':1,'role':'mentee','title':'Block edits','description':'Local'})[1]
        path=f"/api/requests/{req['id']}/comments"
        comment=api(mentor,base,'POST',path,{'body':'keep','clientCommentId':str(uuid4())})[1]
        comment_path=path+f"/{comment['id']}"
        assert api(mentor,base,'PATCH',comment_path,{'body':'spoof','authorId':1})[0]==422
        assert api(owner,base,'POST','/api/blocks',{'blockedUserId':501})[0]==201
        assert api(mentor,base,'PATCH',comment_path,{'body':'blocked edit'})[0]==403
        assert api(mentor,base,'DELETE',comment_path)[0]==403
        assert api(mentor,base,'GET',f"/api/requests/{req['id']}")[0]==403
        assert api(mentor,base,'GET','/api/requests')[1]==[]
        assert api(owner,base,'DELETE','/api/blocks/501')[0]==204
        assert api(mentor,base,'GET',path)[1][0]['body']=='keep'
