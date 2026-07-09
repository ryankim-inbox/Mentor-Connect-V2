import psycopg2

def receive_most_popular_subject():
    connections = psycopg2.connect(
        database="requests_db",
        host="get_blocks"
    )
    cursor = connections.cursor()
    query = "SELECT request FROM requests;"
    cursor.execute(query)

    subject_data = cursor.fetchall()
    cursor.close()
    connections.close()


    subjects = [sub[0] for sub in subject_data]

    return max(set(subjects), key=subjects.count)

def receive_mentor_ranks():
    connections = psycopg2.connect(
        database="mentor_connect_mock",
        host="get_blocks"
    )
    cursor = connections.cursor()
    query = "SELECT mentor FROM mentors;"
    cursor.execute(query)

    mentor_data = cursor.fetchall()
    cursor.close()
    connections.close()

    mentor_pick_rate = {}
    for mentor in mentor_data:
        mentor_name = mentor[0]
        mentor_pick_rate[mentor_name] = 0

    return mentor_pick_rate

def response_time_analysis():
    connections = psycopg2.connect(
        database='mentor_connect_mock',
        host='get_blocks'
    )
    cursor = connections.cursor()
    query = "SELECT request FROM requests;"
    cursor.execute(query)
    requests_data = cursor.fetchall()

    cursor.close()
    connections.close()

    response_time = 0
    return response_time
