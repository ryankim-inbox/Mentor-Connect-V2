"""
Handles block/report-related DB checks.

If student A blocked mentor B, mentor B should not appear on A.
If mentor B blocked student A, mentor A should not appear on B.

Any blocked relationship should prevent them from being connected as mentor-mentee.

Each report can create a warning.
3 reports: serious warning.
5 reports: ban the user.
"""


def receive_block_data():
    """
    Load blocked relationships from the shared project database.

    Returns:
        [(blocker_id, blocked_id), ...]
    """
    from database import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT blocker_id, blocked_id
                FROM blocked_users;
                """
            )
            rows = cur.fetchall()

    return [(row["blocker_id"], row["blocked_id"]) for row in rows]


def prevent_matches(blocks_data, match_possibilities):
    block_s = set(blocks_data)
    good_matches = []

    for match in match_possibilities:
        user1, user2 = match[0], match[1]

        if (user1, user2) not in block_s and (user2, user1) not in block_s:
            good_matches.append(match)
    return good_matches


from collections import Counter


def count_blocks(block_data):
    blockers = [row[0] for row in block_data]
    block_counts = Counter(blockers)
    actions = []

    for user_id, count in block_counts.items():
        if count >= 5:
            actions.append(ban(user_id))
        elif count == 3:
            actions.append(serious_warning(user_id))

    return actions


def serious_warning(user_id):
    """
    Placeholder action for the student project.
    Returning data makes it visible in the Practice Lab without sending real warnings.
    """
    return {
        "user_id": user_id,
        "action": "serious_warning",
        "message": "User reached 3 blocks/reports and should receive a serious warning.",
    }


def ban(user_id):
    """
    Placeholder action for the student project.
    Returning data makes it visible in the Practice Lab without actually banning users.
    """
    return {
        "user_id": user_id,
        "action": "ban",
        "message": "User reached 5 blocks/reports and should be reviewed for a ban.",
    }
