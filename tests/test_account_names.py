import pytest
from pydantic import ValidationError

from routers.auth import RegisterBody
from routers.users import UpdateUserBody


@pytest.mark.parametrize("model", [RegisterBody, UpdateUserBody])
@pytest.mark.parametrize("name", [
    "", " \t\n", "\ufeff", "\u0085", "\u001c", "\u001d", "\u001e", "\u001f",
    "\u001c\ufeff\u001c", "x" * 121, "界" * 41, " " + "x" * 120,
])
def test_display_name_rejects_invalid_input(model, name):
    fields = dict(email="ada@example.edu", password="secret", role="mentee", districtId=1)
    with pytest.raises(ValidationError):
        model(name=name, **fields)


@pytest.mark.parametrize("model", [RegisterBody, UpdateUserBody])
@pytest.mark.parametrize(
    "name, expected",
    [("x" * 120, "x" * 120),
     ("界" * 40, "界" * 40),
     ("  Ada  ", "Ada"),
     ("\ufeffAda\ufeff", "Ada"),
     ("\u0085Ada\u0085", "Ada"),
     ("\u001cAda\u001c", "Ada"),
     ("\u001dAda\u001d", "Ada"),
     ("\u001eAda\u001e", "Ada"),
     ("\u001fAda\u001f", "Ada"),
     ("\u001c\ufeff\u001cAda\u001c\ufeff\u001c", "Ada")],
)
def test_display_name_boundaries(model, name, expected):
    fields = dict(email="ada@example.edu", password="secret", role="mentee", districtId=1)
    assert model(name=name, **fields).name == expected


def test_patch_omitted_or_null_name_remains_a_noop():
    assert UpdateUserBody(bio="Edited bio").name is None
    assert UpdateUserBody(name=None, bio="Edited bio").name is None
