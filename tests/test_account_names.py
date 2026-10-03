import pytest
from pydantic import ValidationError

from routers.auth import RegisterBody
from routers.users import UpdateUserBody


@pytest.mark.parametrize("model", [RegisterBody, UpdateUserBody])
@pytest.mark.parametrize("name", ["", " \t\n", "x" * 121, "界" * 41, " " + "x" * 120])
def test_display_name_rejects_invalid_input(model, name):
    fields = dict(email="ada@example.edu", password="secret", role="mentee", districtId=1)
    with pytest.raises(ValidationError):
        model(name=name, **fields)


@pytest.mark.parametrize("model", [RegisterBody, UpdateUserBody])
@pytest.mark.parametrize(
    "name, expected",
    [("x" * 120, "x" * 120), ("界" * 40, "界" * 40), ("  Ada  ", "Ada")],
)
def test_display_name_boundaries(model, name, expected):
    fields = dict(email="ada@example.edu", password="secret", role="mentee", districtId=1)
    assert model(name=name, **fields).name == expected


def test_patch_omitted_or_null_name_remains_a_noop():
    assert UpdateUserBody(bio="Edited bio").name is None
    assert UpdateUserBody(name=None, bio="Edited bio").name is None
