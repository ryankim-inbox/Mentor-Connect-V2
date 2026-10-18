"""Transaction failure must never enqueue a phantom live event."""
import asyncio
from contextlib import contextmanager
from types import SimpleNamespace
from datetime import datetime, timezone

import pytest
from fastapi import BackgroundTasks
import security
from routers import chat


@pytest.mark.parametrize('kind', ['room', 'dm'])
@pytest.mark.parametrize('commit_fails', [False, True])
def test_only_committed_messages_schedule_broadcast(monkeypatch, kind, commit_fails):
    events = []
    cursor = SimpleNamespace(execute=lambda *args: None, fetchone=lambda: {'id': 7})
    @contextmanager
    def transaction():
        yield SimpleNamespace(cursor=lambda: cursor)
        if commit_fails:
            raise RuntimeError('commit failed')
        events.append('commit')
    async def broadcast(sockets, message):
        assert events == ['commit']
        events.append(message['id'])
    monkeypatch.setattr(chat, 'db', transaction)
    monkeypatch.setattr(chat, '_broadcast', broadcast)
    monkeypatch.setattr(chat, '_load_room_for_user', lambda *args: None)
    monkeypatch.setattr(chat, '_load_conversation_membership', lambda *args: {'user_a_id': 1, 'user_b_id': 2})
    monkeypatch.setattr(chat, '_require_unblocked_pair', lambda *args: None)
    monkeypatch.setattr(chat, '_fetch_chat_message', lambda *args: {'id': 7})
    monkeypatch.setattr(chat, '_fetch_dm_message', lambda *args: {'id': 7})
    tasks = BackgroundTasks()
    send = chat.send_room_message if kind == 'room' else chat.send_dm_message
    if commit_fails:
        with pytest.raises(RuntimeError):
            send(1, chat.SendMessageBody(body='hello'), SimpleNamespace(session={'user_id': 1}), tasks)
    else:
        send(1, chat.SendMessageBody(body='hello'), SimpleNamespace(session={'user_id': 1}), tasks)
    asyncio.run(tasks())
    assert events == ([] if commit_fails else ['commit', 7])


@pytest.fixture(autouse=True)
def synthetic_unit_identity(monkeypatch):
    """Only this unit module: model a persisted verified account for SQL fakes."""
    @contextmanager
    def identity_db():
        state={'id':1}
        def query(sql,params): state['id']=params[0]
        cursor=SimpleNamespace(execute=query,fetchone=lambda:{'id':state['id'],'is_admin':False,'role':'mentee','email_verified_at':datetime(2026,1,1,tzinfo=timezone.utc)})
        yield SimpleNamespace(cursor=lambda:cursor)
    monkeypatch.setattr(security,'db',identity_db)
