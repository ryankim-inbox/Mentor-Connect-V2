import psycopg2

def receive_time_data():
    connections = psycopg2.connect(
        database = "schedules_db",
        host = "get_schedules"
    )
    cursor = connections.cursor()
    query = 'SELECT schedules From schedules_db'
    cursor.execute(query)

    time_data = cursor.fetchall()
    cursor.close()
    connections.close()
    return time_data

def time_dict(student:dict, teacher:dict):
    suggested_times = []
    mentor_time = teacher.get(time)
    student_time = student.get(time)
    if student_time in mentor_time:
         suggested_times.append(student_time)
    return suggested_times