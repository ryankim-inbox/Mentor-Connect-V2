"""Compare location labels without inferring geographic proximity."""


def _labels(person: dict) -> set[str]:
    if "locations" in person:
        labels = person["locations"]
        if not isinstance(labels, list):
            raise ValueError("locations must be a list of nonblank strings")
    else:
        labels = [person["location"]] if "location" in person else []
    if any(not isinstance(label, str) or not label.strip() for label in labels):
        raise ValueError("location labels must be nonblank strings")
    return {label.strip().casefold() for label in labels}


def location_data(student: dict, mentor: dict, question: dict) -> dict:
    """Return sorted shared labels; the question's content has no location meaning."""
    if not all(isinstance(value, dict) for value in (student, mentor, question)):
        raise ValueError("student, mentor, and question must be objects")
    overlap = sorted(_labels(student) & _labels(mentor))
    return {"compatible": bool(overlap), "overlap": overlap}
