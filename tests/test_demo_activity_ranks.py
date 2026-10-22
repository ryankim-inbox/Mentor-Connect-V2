"""Production badges count real, distinct, consenting eligible study partners."""
import importlib
from contextlib import closing

import psycopg2
import pytest


def ranks():
    return importlib.import_module("activity_ranks")


@pytest.mark.parametrize(
    ("count", "tier"),
    [
        (0, None), (1, "Bronze"), (2, "Bronze"),
        (3, "Silver"), (4, "Silver"), (5, "Gold"), (9, "Gold"),
        (10, "Platinum"), (19, "Platinum"), (20, "Emerald"),
        (34, "Emerald"), (35, "Diamond"), (49, "Diamond"),
        (50, "Master"), (74, "Master"), (75, "Grand Master"),
        (99, "Grand Master"), (100, "Challenger"), (101, "Challenger"),
    ],
)
def test_tier_uses_partner_threshold_not_relative_position(count, tier):
    assert ranks().rank_activity_counts([{"id": 7, "matched_count": count}]) == [
        {"userId": 7, "distinctPartners": count, "rank": 1 if count else None, "tier": tier}
    ]


def test_competition_ranks_have_stable_id_ties_and_leave_input_unchanged():
    rows = [
        {"id": 9, "matched_count": 1}, {"id": 8, "matched_count": 3},
        {"id": 2, "matched_count": 3}, {"id": 1, "matched_count": 0},
    ]
    original = [dict(row) for row in rows]
    assert ranks().rank_activity_counts(rows) == [
        {"userId": 2, "distinctPartners": 3, "rank": 1, "tier": "Silver"},
        {"userId": 8, "distinctPartners": 3, "rank": 1, "tier": "Silver"},
        {"userId": 9, "distinctPartners": 1, "rank": 3, "tier": "Bronze"},
        {"userId": 1, "distinctPartners": 0, "rank": None, "tier": None},
    ]
    assert rows == original
    assert ranks().rank_activity_counts([]) == []


@pytest.fixture
def activity_database(backend_database, monkeypatch):
    import db

    monkeypatch.setattr(db, "DATABASE_URL", backend_database)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM blocks")
        conn.commit()
    return backend_database


def add_pair(cur, author_id, peer_id, *, status="matched", application="accepted", applicant=None):
    cur.execute(
        """INSERT INTO requests
           (author_id, district_id, title, description, role, status, matched_user_id)
           VALUES (%s, 1, 'Activity fixture', 'Study together', 'mentee', %s, %s)
           RETURNING id""",
        (author_id, status, peer_id),
    )
    request_id = cur.fetchone()[0]
    if application is not None:
        cur.execute(
            "INSERT INTO request_applications (request_id, applicant_id, status) VALUES (%s, %s, %s)",
            (request_id, peer_id if applicant is None else applicant, application),
        )
    return request_id


def test_accepted_matched_and_closed_partners_count_for_all_student_roles(activity_database):
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        add_pair(cur, 1, 501)
        add_pair(cur, 951, 1, status="closed")
        add_pair(cur, 1, 2)
        add_pair(cur, 501, 951)
        conn.commit()

    assert ranks().get_activity_rank(1) == {
        "userId": 1, "distinctPartners": 3, "rank": 1, "tier": "Silver",
    }
    for user_id in (501, 951):
        assert ranks().get_activity_rank(user_id) == {
            "userId": user_id, "distinctPartners": 2, "rank": 2, "tier": "Bronze",
        }
    assert ranks().get_activity_rank(2) == {
        "userId": 2, "distinctPartners": 1, "rank": 4, "tier": "Bronze",
    }
    assert ranks().get_activity_rank(502) == {
        "userId": 502, "distinctPartners": 0, "rank": None, "tier": None,
    }
    assert ranks().get_activity_rank(999999) is None


def test_repeated_pairs_raw_posts_and_message_spam_cannot_inflate_activity(activity_database):
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        for _ in range(12):
            add_pair(cur, 1, 501)
            add_pair(cur, 501, 1, status="closed")
            add_pair(cur, 1, 951, status="open", application=None)
        cur.execute("""INSERT INTO chat_messages (room_id, sender_id, body)
                       SELECT 1, 1, 'Repeated chat' FROM generate_series(1, 100)""")
        cur.execute("""INSERT INTO dm_messages (conversation_id, sender_id, body)
                       SELECT 1, 1, 'Repeated DM' FROM generate_series(1, 100)""")
        conn.commit()

    for user_id in (1, 501):
        assert ranks().get_activity_rank(user_id) == {
            "userId": user_id, "distinctPartners": 1, "rank": 1, "tier": "Bronze",
        }
    assert ranks().get_activity_rank(951)["distinctPartners"] == 0


@pytest.mark.parametrize(
    ("status", "application", "applicant"),
    [("matched", None, None), ("closed", None, None),
     ("matched", "pending", None), ("matched", "rejected", None),
     ("matched", "cancelled", None), ("open", "accepted", None),
     ("matched", "accepted", 951)],
)
def test_requires_accepted_application_for_exact_matched_partner(
    activity_database, status, application, applicant,
):
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        add_pair(cur, 1, 501, status=status, application=application, applicant=applicant)
        conn.commit()
    for user_id in (1, 501, 951):
        assert ranks().get_activity_rank(user_id)["distinctPartners"] == 0


def test_self_pair_has_no_activity_credit(activity_database):
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        add_pair(cur, 1, 1)
        conn.commit()
    assert ranks().get_activity_rank(1) == {
        "userId": 1, "distinctPartners": 0, "rank": None, "tier": None,
    }


@pytest.mark.parametrize("blocker,blocked", [(1, 501), (501, 1)])
def test_block_in_either_direction_removes_both_participants_credit(activity_database, blocker, blocked):
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        add_pair(cur, 1, 501)
        cur.execute("INSERT INTO blocks (blocker_id, blocked_user_id) VALUES (%s, %s)", (blocker, blocked))
        conn.commit()
    for user_id in (1, 501):
        assert ranks().get_activity_rank(user_id)["distinctPartners"] == 0


@pytest.mark.parametrize("excluded", ["admin", "unverified", "locked"])
@pytest.mark.parametrize("excluded_id", [1, 501])
def test_ineligible_authors_and_peers_receive_and_contribute_no_credit(activity_database, excluded, excluded_id):
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        add_pair(cur, 1, 501)
        updates = {
            "admin": "is_admin=true",
            "unverified": "email_verified_at=NULL, is_verified=false",
            "locked": "password_hash='!mentor-connect-synthetic:activity-fixture'",
        }
        cur.execute(f"UPDATE users SET {updates[excluded]} WHERE id=%s", (excluded_id,))
        conn.commit()
    if excluded == 'unverified':
        assert ranks().get_activity_rank(excluded_id)['distinctPartners'] == 1
        assert ranks().get_activity_rank(501 if excluded_id == 1 else 1)['distinctPartners'] == 1
        return
    assert ranks().get_activity_rank(excluded_id) is None
    other_id = 501 if excluded_id == 1 else 1
    assert ranks().get_activity_rank(other_id) == {
        "userId": other_id, "distinctPartners": 0, "rank": None, "tier": None,
    }


def test_all_983_locked_synthetic_profiles_cannot_create_badges(activity_database):
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO users
                       (id, email, name, password_hash, role, district_id, is_verified, email_verified_at)
                       SELECT n, 'synthetic-' || n || '@test.edu', 'Synthetic fixture',
                              '!mentor-connect-synthetic:activity-fixture', 'mentor', 1, true, now()
                       FROM generate_series(10000, 10982) n""")
        cur.execute("""INSERT INTO requests
                       (author_id, district_id, title, description, role, status, matched_user_id)
                       SELECT 1, 1, 'Synthetic activity', 'Fixture', 'mentee', 'matched', n
                       FROM generate_series(10000, 10982) n""")
        cur.execute("""INSERT INTO request_applications (request_id, applicant_id, status)
                       SELECT id, matched_user_id, 'accepted' FROM requests""")
        conn.commit()
    assert ranks().get_activity_rank(1) == {
        "userId": 1, "distinctPartners": 0, "rank": None, "tier": None,
    }
    assert ranks().get_activity_rank(10000) is None


def test_current_eligibility_is_rechecked_after_admin_promotion(activity_database):
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        add_pair(cur, 1, 501)
        conn.commit()
        assert ranks().get_activity_rank(1)["distinctPartners"] == 1
        cur.execute("UPDATE users SET is_admin=true WHERE id=501")
        conn.commit()
    assert ranks().get_activity_rank(501) is None
    assert ranks().get_activity_rank(1)["distinctPartners"] == 0


def test_unverified_members_rank_independently_of_legacy_test_configuration(activity_database, monkeypatch):
    for key, value in {
        "TEST_MEMBER_ACCESS_ENABLED": "true",
        "APP_ORIGIN": "https://mentor-connect-test.onrender.com",
        "GATEWAY_PUBLIC_ORIGIN": "https://mentor-connect-test.onrender.com",
        "TEST_MEMBER_MENTOR_ID": "501", "TEST_MEMBER_MENTEE_ID": "1",
    }.items():
        monkeypatch.setenv(key, value)
    with closing(psycopg2.connect(activity_database)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET email_verified_at=NULL, is_verified=false")
        add_pair(cur, 1, 501)
        conn.commit()
    assert ranks().get_activity_rank(1)["distinctPartners"] == 1
    assert ranks().get_activity_rank(501)["distinctPartners"] == 1
    assert ranks().get_activity_rank(951) == {
        "userId": 951, "distinctPartners": 0, "rank": None, "tier": None,
    }
    monkeypatch.setenv("TEST_MEMBER_ACCESS_ENABLED", "false")
    assert ranks().get_activity_rank(1)["distinctPartners"] == 1


@pytest.mark.parametrize("user_id", [0, -1, True, "1", None, 2147483648])
def test_invalid_profile_ids_return_no_rank_without_database_access(user_id, monkeypatch):
    module = ranks()
    monkeypatch.setattr(module, "db", lambda: pytest.fail("invalid ID must not query"))
    assert module.get_activity_rank(user_id) is None
