from db import db
"""
Handles block/report-related DB checks.

If student A blocked mentor B, mentor B should not appear on A
If mentor B blocked student A, mentor A should not appear on B

Any blocked relationship should prevent them from being connected as mentor-mentee

each report, we give warning

3 reports, give serious warning

5 reports, ban the user (Maybe have another DB, and add the USER data in, to prevent sign up

"""

def receive_block_data() -> list[tuple[int, int]]:
    with db() as conn, conn.cursor() as cursor:
        cursor.execute("SELECT blocker_id, blocked_user_id FROM blocks;")
        return [(row["blocker_id"], row["blocked_user_id"]) for row in cursor.fetchall()]

def prevent_matches(blocks_data, match_possibilities):
    block_s = set(blocks_data)
    good_matches = []

    for match in match_possibilities:
        user1, user2 = match[0], match[1]

        if (user1, user2) not in block_s and (user2, user1) not in block_s:
            good_matches.append(match)
    return good_matches

from collections import Counter

# def count_blocks(block_data):
#     blockers = [row[0] for row in block_data]
#     block_counts = Counter(blockers)
#     for user_id, count in block_counts.items():
#         if count == 3:
#             serious_warning(user_id)
#         elif count >= 5:
#             ban(user_id)
# def serious_warning(user_id):
#
# def ban(user_id):
