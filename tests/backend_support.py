"""Real HTTP helpers shared by disposable backend integration tests."""
import json
from typing import Any
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, OpenerDirector, build_opener


def api(client, base, method, path, body=None) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    request = Request(base + path, data=data, method=method,
                      headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:14200"})
    try:
        response = client.open(request, timeout=3)
    except HTTPError as exc:
        response = exc
    with response:
        payload = response.read().decode()
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            pass
        return response.status, payload


def login(base, email) -> tuple[OpenerDirector, str]:
    jar = CookieJar()
    client = build_opener(HTTPCookieProcessor(jar))
    status, result = api(client, base, "POST", "/api/auth/login",
                         {"email": email, "password": "Password123!"})
    assert status == 200, result
    cookie = "; ".join(f"{item.name}={item.value}" for item in jar)
    return client, cookie
