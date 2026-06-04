import time
import psycopg2
from Python.get_blocks import serious_warning
from Python.get_blocks import ban

def spam_data():
    connections = psycopg2.connect(
        database="spam_db",
        host="get_spam"
    )
    cursor = connections.cursor()
    query = 'SELECT updated_at From users_db'
    cursor.execute(query)

    spam_data = cursor.fetchall()
    cursor.close()
    connections.close()
    return spam_data


def block_spam(user: dict, user_db: updated_at):
    serious_warning = 0
    user_message_time = user.get(updated_at)
    #If user_message_time is updated within an hour, we assume they are spamming
    if updated_at != user_message_time:
        if abs(updated_at - user_message_time)<=60:
            serious_warning()
            for u in user:
                serious_warning += 1

if serious_warning >= 5:
    ban()