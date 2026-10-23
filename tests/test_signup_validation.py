"""New-signup trust boundaries, distinct from existing-account login policy."""
from contextlib import closing
from datetime import date, timedelta
from http.cookiejar import CookieJar
import json
import string
from urllib.request import HTTPCookieProcessor, build_opener

import bcrypt
import psycopg2
import pytest
from pydantic import ValidationError

from backend_support import api, login
from routers.auth import LoginBody, RegisterBody


VALID = dict(email="signup@school.edu", name="Student", password="Password123!",
             role="mentee", districtId=1, gender="female", dateOfBirth="2008-02-29")


@pytest.mark.parametrize("password", [
    "", "Abcdefghij!", "lowercase123!", "Uppercase1234", "Äbcdefghijk!",
    "Abcdefghijk😀", "Abcdefghijk ", "A!" + "a" * 71,
    "A!" + "😀" * 9, "A!" + "😀" * 17 + "界", "A!abcdefghij\ud800",
])
def test_signup_rejects_passwords_outside_character_and_byte_limits(password):
    with pytest.raises(ValidationError) as error:
        RegisterBody(**{**VALID, "password": password})
    assert ("password",) in {item["loc"] for item in error.value.errors()}


@pytest.mark.parametrize("password", [
    "Password123!", "A!" + "😀" * 10, "A!" + "a" * 70,
    "A!" + "😀" * 17 + "aa", "A!" + "界" * 23 + "a",
    *["Abcdefghijk" + punctuation for punctuation in string.punctuation],
])
def test_signup_accepts_unicode_and_every_ascii_punctuation(password):
    body = RegisterBody(**{**VALID, "password": password})
    assert body.password == password


@pytest.mark.parametrize("value", [
    None, "", "2008-2-29", "20080229", "2008-W09-5", "2008-02-29T00:00:00Z",
    " 2008-02-29", "2008-02-29\n", "2009-02-29", "1900-02-29", "2008-04-31",
    "0000-01-01", "２００８-０２-２９", 1204243200, True,
    (date.today() + timedelta(days=1)).isoformat(),
])
def test_signup_rejects_invalid_or_future_birth_dates(value):
    with pytest.raises(ValidationError) as error:
        RegisterBody(**{**VALID, "dateOfBirth": value})
    assert ("dateOfBirth",) in {item["loc"] for item in error.value.errors()}


@pytest.mark.parametrize("value", ["0001-01-01", "2000-02-29", "2008-02-29", date.today().isoformat()])
def test_signup_accepts_real_birth_dates_through_today(value):
    body = RegisterBody(**{**VALID, "dateOfBirth": value})
    assert body.dateOfBirth == date.fromisoformat(value)


@pytest.mark.parametrize("gender", ["female", "male"])
def test_signup_accepts_required_gender_without_changing_case(gender):
    assert RegisterBody(**{**VALID, "gender": gender}).gender == gender


@pytest.mark.parametrize("gender", [None, "", "Female", "other", 1])
def test_signup_rejects_unsupported_gender(gender):
    with pytest.raises(ValidationError) as error:
        RegisterBody(**{**VALID, "gender": gender})
    assert ("gender",) in {item["loc"] for item in error.value.errors()}


@pytest.mark.parametrize("field", ["gender", "dateOfBirth"])
def test_new_signups_require_private_fields(field):
    body = {key: value for key, value in VALID.items() if key != field}
    with pytest.raises(ValidationError) as error:
        RegisterBody(**body)
    assert (field,) in {item["loc"] for item in error.value.errors()}


def test_signup_model_and_errors_do_not_print_private_values():
    body = RegisterBody(**VALID)
    for value in (VALID["password"], VALID["gender"], VALID["dateOfBirth"]):
        assert value not in repr(body)
    with pytest.raises(ValidationError) as error:
        RegisterBody(**{**VALID, "password": "PrivateWeakSecret", "dateOfBirth": "SecretBirthDate", "gender": "SecretGender"})
    assert "PrivateWeakSecret" not in str(error.value)
    assert "SecretBirthDate" not in str(error.value)
    assert "SecretGender" not in str(error.value)


def test_signup_policy_does_not_change_login_validation():
    assert LoginBody(email="existing@school.edu", password="old").password == "old"


@pytest.mark.parametrize("changes", [
    {"password": "PrivateWeakSecret"}, {"dateOfBirth": "SecretBirthDate"},
    {"gender": "SecretGender"}, {"unexpected": "PrivateExtraValue"},
    {"gender": None}, {"dateOfBirth": None},
    {"password": "A!" + "😀" * 17 + "界"},
])
def test_invalid_signup_http_response_never_echoes_inputs(backend_server, backend_database, changes):
    with backend_server() as base:
        submitted = {**VALID, **changes}
        status, response = api(build_opener(), base, "POST", "/api/auth/register", submitted)
        assert status == 422, response
        serialized = json.dumps(response, ensure_ascii=False)
        for key in ("password", "gender", "dateOfBirth", "unexpected"):
            value = submitted.get(key)
            if isinstance(value, str):
                assert value not in serialized
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM users WHERE email = %s", (VALID["email"],))
        assert cur.fetchone()[0] == 0


def test_missing_private_field_errors_do_not_echo_the_registration_body(backend_server):
    with backend_server() as base:
        for omitted in ("gender", "dateOfBirth"):
            body = {key: value for key, value in VALID.items() if key != omitted}
            status, response = api(build_opener(), base, "POST", "/api/auth/register", body)
            assert status == 422, response
            serialized = json.dumps(response)
            for private in (VALID["password"], VALID["dateOfBirth"], VALID["gender"]):
                assert private not in serialized


@pytest.mark.parametrize("password", ["Password123!", "A!" + "😀" * 17 + "aa"])
def test_new_signup_stores_private_fields_without_returning_them(backend_server, backend_database, password):
    submitted = {**VALID, "password": password}
    with backend_server() as base:
        client = build_opener(HTTPCookieProcessor(CookieJar()))
        status, response = api(client, base, "POST", "/api/auth/register", submitted)
        assert status == 201, response
        user_id = response["user"]["id"]
        viewer, _ = login(base, "student001@test.edu")
        responses = [response]
        for caller, path in [(client, "/api/auth/me"), (client, f"/api/users/{user_id}"), (viewer, f"/api/users/{user_id}")]:
            status, payload = api(caller, base, "GET", path)
            assert status == 200, payload
            responses.append(payload)
        status, payload = api(client, base, "POST", "/api/auth/login", {"email": VALID["email"], "password": password})
        assert status == 200, payload
        responses.append(payload)
        for payload in responses:
            serialized = json.dumps(payload, ensure_ascii=False)
            for private in ("gender", "dateOfBirth", "date_of_birth", password, VALID["dateOfBirth"]):
                assert private not in serialized
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT gender, date_of_birth, password_hash, is_verified, is_admin FROM users WHERE id = %s", (user_id,))
        gender, born, hashed, verified, admin = cur.fetchone()
        assert (gender, born, verified, admin) == ("female", date(2008, 2, 29), False, False)
        assert bcrypt.checkpw(password.encode(), hashed.encode())


def test_legacy_login_keeps_weak_password_and_missing_demographics(backend_server, backend_database):
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO users (email, name, password_hash, role, district_id) VALUES (%s, %s, %s, %s, %s)",
                    ("legacy@school.edu", "Legacy", bcrypt.hashpw(b"old", bcrypt.gensalt()).decode(), "mentee", 1))
        conn.commit()
    with backend_server() as base:
        client = build_opener(HTTPCookieProcessor(CookieJar()))
        status, response = api(client, base, "POST", "/api/auth/login", {"email": "legacy@school.edu", "password": "old"})
        assert status == 200, response
        assert api(client, base, "GET", "/api/auth/me")[0] == 200
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT gender, date_of_birth FROM users WHERE email = %s", ("legacy@school.edu",))
        assert cur.fetchone() == (None, None)
