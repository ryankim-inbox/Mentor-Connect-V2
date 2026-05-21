users = [
    {
        "id": 3,
        "email": "ericpark@a.edu",
        "name": "Eric Park",
        "password_hash": "$2b$10$WizxKJgd0OvlrCR...",
        "role": "both",
        "district_id": 103,
        "is_verified": True
    },
    {
        "id": 4,
        "email": "ssinkbig@naver.edu",
        "name": "Eric Park",
        "password_hash": "$2b$12$aD/iNrz0YoqDtDG...",
        "role": "mentee",
        "district_id": 103,
        "is_verified": True,
        
    }
]
requests = [
    {
        "id": 2,
        "author_id": 4,
        "district_id": 82,
        "title": "help",
        "role": "mentee",
        "status": "open"
    },
    {
        "id": 3,
        "author_id": 4,
        "district_id": 97,
        "title": "helppppp",
        "role": "mentor",
        "status": "open"
    }
]
def get_likelihood(item_a, item_b):
    likelihood = 0
    keys_to_compare = ["name", "district_id", "role", "status"]

    for key in keys_to_compare:
        if key in item_a and key in item_b:
            if item_a[key] == item_b[key]:
                likelihood += 1
            elif key == "role" and (item_a[key] == "both" or item_b[key] == "both"):
                likelihood += 1

    return likelihood