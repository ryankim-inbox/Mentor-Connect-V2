import psycopg2

def receive_most_popular_subject():
    connections = psycopg2.connect(
        database="requests_db",
        host="get_blocks"
    )
    cursor = connections.cursor()
    query="SELECT request FROM requests;"
    cursor.execute(query)

    subject_data = cursor.fetchall()
    cursor.close()
    connections.close()
    sub_count=0
    for sub in subject_data:
        sub_count+=1
    return max(sub)

def receive_mentor_ranks():
    connections = psycopg2.connect(
        database="mentors_db",
        host="get_blocks"
    )
    cursor = connections.cursor()
    query="SELECT mentor FROM mentors;"
    cursor.execute(query)

    mentor_data = cursor.fetchall()
    cursor.close()
    connections.close()
    for mentor in mentor_data:
        mentor_pick_rate = {
            mentor:pick
        }

def response_time_analysis():
    connections = psycopg2.connect(
        database = 'requests_db'
        host='get_blocks'
    )
    cursor = connections.cursor()
    query = "SELECT request FROM requests;"
    cursor.execute(query)
    requests_data=cursor.fetchall()

    accept_time-mentor_time=response_time
    return response_time