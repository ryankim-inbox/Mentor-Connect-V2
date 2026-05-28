from find_matches import calculate_match_score
import psycopg2

def receive_location_data():
    connections = psycopg2.connect(
        database="locations_db",
        host="get_locations"
    )
    cursor = connections.cursor()
    query="SELECT locations FROM location_db;"
    cursor.execute(query)

    location_data = cursor.fetchall()
    cursor.close()
    connections.close()
    return location_data
score = 0
def location_data(student:dict, mentor:dict, question:dict):
    mentor_locations = mentor.get(locations)
    student_locations = student.get(locations)
    if student_locations in mentor_locations:
        score += 10
    return score