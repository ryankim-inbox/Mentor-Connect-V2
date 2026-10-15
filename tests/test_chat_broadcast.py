"""Transaction failure must never enqueue a phantom live event."""
import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks
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
