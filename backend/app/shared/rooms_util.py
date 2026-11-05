"""Shared room code and player name validation across games."""

from __future__ import annotations

import re
import unicodedata

# No vowels, so room codes can't spell anything rude. 20^4 = 160k codes.
CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"
CODE_LENGTH = 4

# Letters (any language), digits, spaces, and a little punctuation.
NAME_RE = re.compile(r"[\w .'\-]{1,14}")


class JoinError(Exception):
    """A player-facing reason a join was rejected."""


class RoomLimitError(Exception):
    pass


def normalize_name(raw: object) -> str:
    if not isinstance(raw, str):
        raise JoinError("Pick a name.")
    name = " ".join(unicodedata.normalize("NFKC", raw).split())
    if not NAME_RE.fullmatch(name):
        raise JoinError("Names are 1\u201314 letters, numbers, or spaces.")
    return name


def normalize_code(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    code = raw.strip().upper()
    if len(code) != CODE_LENGTH or any(c not in CODE_ALPHABET for c in code):
        return None
    return code
