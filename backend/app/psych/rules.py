"""Pure rules for Psychological: scoring, guessing order, and winners. No I/O."""

from __future__ import annotations

GRID_SIZE = 10
EXACT_POINTS = 3
ORTHOGONAL_POINTS = 2
DIAGONAL_POINTS = 1

Square = tuple[int, int]


def valid_square(x: object, y: object) -> bool:
    """True for integer coordinates on the 1..10 grid (bools don't count)."""
    return (
        isinstance(x, int)
        and isinstance(y, int)
        and not isinstance(x, bool)
        and not isinstance(y, bool)
        and 1 <= x <= GRID_SIZE
        and 1 <= y <= GRID_SIZE
    )


def score(guess: Square, secret: Square) -> int:
    """3 for the exact square, 2 one step up/down/left/right, 1 diagonally next to it."""
    dx = abs(guess[0] - secret[0])
    dy = abs(guess[1] - secret[1])
    if dx == 0 and dy == 0:
        return EXACT_POINTS
    if dx + dy == 1:
        return ORTHOGONAL_POINTS
    if dx == 1 and dy == 1:
        return DIAGONAL_POINTS
    return 0


def guess_order(seats: list[str], main_id: str) -> list[str]:
    """Everyone but the main player, starting with the seat after them and wrapping."""
    if main_id not in seats:
        return list(seats)
    i = seats.index(main_id)
    return seats[i + 1 :] + seats[:i]


def winners(scores: dict[str, int], target: int) -> list[str]:
    """Players tied for the top score, if that score reached the target; else nobody."""
    if not scores:
        return []
    top = max(scores.values())
    if top < target:
        return []
    return [pid for pid, s in scores.items() if s == top]
