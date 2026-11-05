import pytest

from app.spiritboard import rooms


@pytest.fixture(autouse=True)
def _no_practice_round(monkeypatch):
    """Most tests are about real rounds; test_practice.py turns practice back on."""
    monkeypatch.setattr(rooms, "PRACTICE_DEFAULT", False)
