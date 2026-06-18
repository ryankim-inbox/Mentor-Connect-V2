import psycopg2
from datetime import datetime

current_time=str(datetime.now())
def new_ppl_data():
    connections = psycopg2.connect(
    database="users_db",
    host="get_users"
    )
    cursor = connections.cursor()
    query="SELECT created_at FROM users;"
    cursor.execute(query)

    ppl_data = cursor.fetchall()
    cursor.close()
    connections.close()
    return ppl_data

def daily_count():
    daily_count = 0
    for times in ppl_data:
        if current_time[0:10] == times[0:10]:
            daily_count+=1
    return daily_count

def monthly_count():
    monthly_count = 0
    for times in ppl_data:
        if current_time[0:7]==times[0:7]:
            monthly_count += 1
    return monthly_count

def yearly_count():
    yearly_count=0
    for times in ppl_data:
        if current_time[0:4]==times[0:4]:
            yearly_count+=1
    return yearly_count