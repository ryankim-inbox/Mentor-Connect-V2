"""A waiting socket DB operation must not stall unrelated HTTP work."""
import asyncio
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import contextmanager
import importlib
from threading import Event, Thread
from types import SimpleNamespace

import pytest

from routers import chat


@pytest.mark.parametrize('phase', ['room-admission', 'dm-admission', 'dm-message'])
@pytest.mark.parametrize('boundary', ['authority', 'transaction'])
def test_socket_database_wait_allows_health_response(monkeypatch, phase, boundary):
    # A production change that moves either DB boundary onto the event loop
    # makes the health response unable to finish until the gate is released.
    monkeypatch.setenv('SESSION_SECRET', 'local-event-loop-test-session-secret')
    app = importlib.import_module('main').app
    entered, release = Event(), Event()
    calls = {'authority': 0, 'transaction': 0}
    target_call = 2 if phase == 'dm-message' else 1
    committed = []
    outcome = {}

    def gate(name):
        calls[name] += 1
        if name == boundary and calls[name] == target_call:
            entered.set()
            if not release.wait(10):
                raise AssertionError('diagnostic gate was not released')

    def authority(socket):
        gate('authority')
        return {'id': socket.session['user_id']}

    @contextmanager
    def transaction():
        gate('transaction')
        cursor = SimpleNamespace(execute=lambda *args: None, fetchone=lambda: {'id': 42})
        yield SimpleNamespace(cursor=lambda: cursor)
        committed.append(True)

    class Socket:
        session = {'user_id': 1}
        accepted = False
        close_codes = []

        async def accept(self):
            self.accepted = True

        async def close(self, code):
            self.close_codes.append(code)

        async def iter_text(self):
            if phase == 'dm-message':
                yield 'synthetic socket message'

    published = []

    async def broadcast(sockets, message):
        assert len(committed) == 2
        published.append(message)

    monkeypatch.setattr(chat, 'require_verified_user', authority)
    monkeypatch.setattr(chat, 'db', transaction)
    monkeypatch.setattr(chat, '_load_room_for_user', lambda *args: None)
    monkeypatch.setattr(chat, '_load_conversation_membership', lambda *args: {'user_a_id': 1, 'user_b_id': 2})
    monkeypatch.setattr(chat, '_require_unblocked_pair', lambda *args: None)
    monkeypatch.setattr(chat, '_fetch_dm_message', lambda *args: {'id': 42})
    monkeypatch.setattr(chat, '_broadcast', broadcast)
    monkeypatch.setattr(chat, 'room_connections', {})
    monkeypatch.setattr(chat, 'dm_connections', {})
    socket = Socket()

    async def health_probe():
        messages = []

        async def receive():
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        async def send(message):
            messages.append(message)

        await app({
            'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
            'method': 'GET', 'scheme': 'http', 'path': '/api/healthz',
            'raw_path': b'/api/healthz', 'query_string': b'', 'root_path': '',
            'headers': [], 'client': ('127.0.0.1', 1), 'server': ('127.0.0.1', 2),
        }, receive, send)
        assert messages[0]['type'] == 'http.response.start'
        assert messages[0]['status'] == 200
        assert messages[-1]['type'] == 'http.response.body'
        assert not messages[-1].get('more_body', False)
        return not release.is_set()

    async def exercise():
        loop = asyncio.get_running_loop()

        def coordinate():
            future = None
            try:
                assert entered.wait(3), 'socket never reached the selected DB boundary'
                outcome['accepted_at_gate'] = socket.accepted
                future = asyncio.run_coroutine_threadsafe(health_probe(), loop)
                try:
                    outcome['health_before_release'] = future.result(timeout=3)
                except FutureTimeout:
                    outcome['health_before_release'] = False
                    future.cancel()
            except BaseException as error:
                outcome['error'] = error
            finally:
                release.set()

        coordinator = Thread(target=coordinate, daemon=True)
        coordinator.start()
        try:
            endpoint = chat.chat_room_socket if phase == 'room-admission' else chat.dm_socket
            await endpoint(socket, 7)
        finally:
            release.set()
            await asyncio.to_thread(coordinator.join, 5)
        assert not coordinator.is_alive()

    asyncio.run(exercise())
    if 'error' in outcome:
        raise outcome['error']
    assert outcome['accepted_at_gate'] == (phase == 'dm-message')
    assert outcome['health_before_release'], 'socket DB wait blocked the independent health response'
    assert socket.accepted and socket.close_codes == []
    assert published == ([{'id': 42}] if phase == 'dm-message' else [])
    assert chat.room_connections == {} and chat.dm_connections == {}
