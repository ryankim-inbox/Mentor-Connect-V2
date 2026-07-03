# Ranks:
# Mud => Top 10000 Mentors
# Bronze => Top 5000 Mentors
# Steel => Top 2000 Mentors
# Silver => Top 1000 mentors
# Gold => Top 500 mentors
# Diamond => Top 100 mentors
# Platinum => Top 10 mentors
# Master => Top mentor

import psycopg2
def rank_data():
    connections = psycopg2.connect(
        database="users_db",
        host="get_users"
    )
    cursor = connections.cursor()
    query="SELECT mentored_count FROM users;"
    cursor.execute(query)

    count_data = cursor.fetchall()
    cursor.close()
    connections.close()
    return count_data

ranked_list=()

for count in count_data:
    