"""Role-wise gateway socket authority on a disposable real PostgreSQL backend."""
import json
from urllib.request import build_opener
import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect
from backend_support import api, login
from test_account_trust import execute, unverify

ORIGIN = 'http://127.0.0.1:14200'

@pytest.mark.parametrize('role,email,user_id,forbidden_room,forbidden_dm', [
    ('mentor','mentor501@test.edu',501,3,2),
    ('mentee','student001@test.edu',1,3,None),
    ('both','both951@test.edu',951,2,1),
])
def test_each_student_role_preserves_global_chat_and_denies_foreign_room_and_dm(gateway_server,backend_database,role,email,user_id,forbidden_room,forbidden_dm):
    client,cookie=login(gateway_server,email)
    assert api(client,gateway_server,'GET','/api/auth/me')[1]['role']==role
    if forbidden_dm is None:
        forbidden_dm=execute(backend_database,'INSERT INTO dm_conversations (user_a_id,user_b_id) VALUES (501,951) RETURNING id')[0][0]
    ws=gateway_server.replace('http://','ws://')
    for path in (f'/ws/chat/rooms/{forbidden_room}',f'/ws/dms/{forbidden_dm}'):
        with pytest.raises(InvalidStatus) as error:
            with connect(ws+path,origin=ORIGIN,additional_headers={'Cookie':cookie},open_timeout=3):
                pytest.fail('Unauthorized student socket accepted')
        assert error.value.response.status_code==403
    with connect(ws+'/ws/chat/rooms/1',origin=ORIGIN,additional_headers={'Cookie':cookie},open_timeout=3) as socket:
        socket.send(f'E2E TEST verified {role} global message')
        message=json.loads(socket.recv(timeout=3))
        assert message['senderId']==user_id and message['body']==f'E2E TEST verified {role} global message'

@pytest.mark.parametrize('identity',['anonymous','unverified'])
@pytest.mark.parametrize('path',['/ws/chat/rooms/1','/ws/dms/1'])
def test_no_socket_authority_without_ownership(gateway_server,backend_database,identity,path):
    headers={}
    if identity=='unverified':
        _,cookie=login(gateway_server,'student001@test.edu')
        unverify(backend_database)
        headers={'Cookie':cookie}
    with pytest.raises(InvalidStatus) as error:
        with connect(gateway_server.replace('http://','ws://')+path,origin=ORIGIN,additional_headers=headers,open_timeout=3):
            pytest.fail('Socket accepted without current ownership')
    assert error.value.response.status_code==403
