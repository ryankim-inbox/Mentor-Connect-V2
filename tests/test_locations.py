"""Location compatibility is label matching through the real practice API."""
import pytest

from backend_support import api, login
from locations import location_data


@pytest.mark.parametrize("student,mentor,expected", [
    ({"locations": ["San Jose"]}, {"locations": ["San Jose", "Cupertino"]},
     {"compatible": True, "overlap": ["san jose"]}),
    ({"locations": [" ZURICH ", "Straße", "zurich", "  San Jose"]},
     {"locations": ["STRASSE", "SAN JOSE ", "Zurich", "strasse"]},
     {"compatible": True, "overlap": ["san jose", "strasse", "zurich"]}),
    ({"location": " San Jose "}, {"location": "SAN JOSE"},
     {"compatible": True, "overlap": ["san jose"]}),
    ({"locations": ["San Jose"], "location": 123}, {"location": "san jose"},
     {"compatible": True, "overlap": ["san jose"]}),
    ({"locations": [], "location": "San Jose"}, {"location": "San Jose"},
     {"compatible": False, "overlap": []}),
    ({"location": "San Jose"}, {"locations": ["Cupertino"]},
     {"compatible": False, "overlap": []}),
    ({}, {}, {"compatible": False, "overlap": []}),
    ({}, {"locations": ["San Jose"]}, {"compatible": False, "overlap": []}),
    ({"locations": ["San Jose"]}, {}, {"compatible": False, "overlap": []}),
])
def test_location_label_compatibility(student, mentor, expected):
    assert location_data(student, mentor, {"subject": "math"}) == expected
    assert location_data(student, mentor, {}) == expected


@pytest.mark.parametrize("bad", [
    None, [], "San Jose", 3,
    {"locations": None}, {"locations": "San Jose", "location": "San Jose"},
    {"locations": ("San Jose",)}, {"locations": ["San Jose", None]},
    {"locations": [3]}, {"locations": [True]}, {"locations": [""]},
    {"locations": ["  "]}, {"location": None}, {"location": []},
    {"location": 3}, {"location": ""}, {"location": "  "},
])
def test_location_rejects_malformed_supplied_values(bad):
    with pytest.raises(ValueError):
        location_data(bad, {"locations": []}, {})
    with pytest.raises(ValueError):
        location_data({}, bad, {})


@pytest.mark.parametrize("question", [None, [], "math", 3])
def test_location_requires_question_object(question):
    with pytest.raises(ValueError):
        location_data({}, {}, question)


def test_real_gateway_location_status_and_invocation(gateway_server):
    client, _ = login(gateway_server, "student001@test.edu")
    status, result = api(client, gateway_server, "GET", "/api/practice/locations/status")
    assert status == 200 and result["success"] and result["is_real"], result
    assert result["status"] == "connected"
    assert result["available_functions"] == ["location_data"]
    for mentor, expected in [
        ({"locations": ["San Jose", "Cupertino"]}, {"compatible": True, "overlap": ["san jose"]}),
        ({"locations": ["Cupertino"]}, {"compatible": False, "overlap": []}),
    ]:
        status, result = api(client, gateway_server, "POST", "/api/practice/locations/test", {
            "student": {"locations": ["San Jose"]}, "mentor": mentor,
            "question": {"subject": "math"},
        })
        assert status == 200 and result["success"] and result["is_real"], result
        assert result["function_called"] == "location_data"
        assert result["result"] == expected
    status, result = api(client, gateway_server, "POST", "/api/practice/locations/test", {
        "student": {"locations": "San Jose"}, "mentor": {}, "question": {},
    })
    assert status == 200 and result["success"] is False, result
    assert result["status"] == "runtime error" and result["is_real"] is False
    assert result["error"] == "student_module_error"
