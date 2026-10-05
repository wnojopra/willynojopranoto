"""Planchette physics and board layout for Spirit Board.

All coordinates are in "board units": the board is BOARD_W wide and BOARD_H
tall, with the origin at the top-left and +y pointing down (screen space).
The server is authoritative; clients only render what we broadcast.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

BOARD_W = 1.6
BOARD_H = 1.0

# Where the planchette starts each round (center of the board, so every
# answer spot on the ring is equally far away).
START_X = BOARD_W / 2
START_Y = 0.52

# Ring the answer spots are laid out on.
RING_RX = 0.62
RING_RY = 0.36

# Movement tuning. These are playtest knobs.
ACCEL = 1.4  # how strongly the combined pull accelerates the planchette
DRAG = 3.0  # velocity damping per second (higher = more sluggish)
MAX_SPEED = 1.1  # board units per second
EDGE_MARGIN = 0.06

# Lock-in tuning.
SPOT_RADIUS = 0.085
LOCK_SECONDS = 2.0


@dataclass(frozen=True)
class Spot:
    id: str
    label: str
    x: float
    y: float

    def to_dict(self) -> dict:
        return {"id": self.id, "label": self.label, "x": self.x, "y": self.y}


@dataclass
class Planchette:
    x: float = START_X
    y: float = START_Y
    vx: float = 0.0
    vy: float = 0.0
    # Spot the planchette is currently resting in, and for how long.
    hover_spot: str | None = None
    hover_time: float = 0.0
    # Last combined force, sent to the TV to draw the "pull aura".
    fx: float = 0.0
    fy: float = 0.0

    def reset(self) -> None:
        self.x, self.y = START_X, START_Y
        self.vx = self.vy = 0.0
        self.hover_spot = None
        self.hover_time = 0.0
        self.fx = self.fy = 0.0

    @property
    def lock_progress(self) -> float:
        return min(1.0, self.hover_time / LOCK_SECONDS)


def sanitize_pull(dx: object, dy: object) -> tuple[float, float]:
    """Validates a raw pull vector from a client.

    Anything that isn't a finite number becomes 0, and the vector is clamped
    to magnitude <= 1 so nobody can pull harder than everyone else.
    """
    try:
        fx = float(dx)  # type: ignore[arg-type]
        fy = float(dy)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return (0.0, 0.0)
    if not (math.isfinite(fx) and math.isfinite(fy)):
        return (0.0, 0.0)
    mag = math.hypot(fx, fy)
    if mag > 1.0:
        fx, fy = fx / mag, fy / mag
    return (fx, fy)


def combine_pulls(pulls: list[tuple[float, float]]) -> tuple[float, float]:
    """Combines every player's pull into one force.

    Sum scaled by 1/sqrt(n): a unanimous room is faster than one player, but
    not n times faster, and opposing pulls cancel out (tug-of-war).
    """
    if not pulls:
        return (0.0, 0.0)
    sx = sum(p[0] for p in pulls)
    sy = sum(p[1] for p in pulls)
    scale = 1.0 / math.sqrt(len(pulls))
    return (sx * scale, sy * scale)


def layout_spots(labels: list[tuple[str, str]]) -> list[Spot]:
    """Places answer spots evenly on an ellipse around the start position.

    Args:
      labels: (id, label) pairs, in display order.
    """
    n = len(labels)
    spots = []
    for i, (spot_id, label) in enumerate(labels):
        # Start at the top and go clockwise. Offset by half a step when n is
        # even so no spot sits directly above the start (looks nicer).
        offset = math.pi / n if n % 2 == 0 else 0.0
        theta = -math.pi / 2 + offset + (2 * math.pi * i) / n
        x = START_X + RING_RX * math.cos(theta)
        y = START_Y + RING_RY * math.sin(theta)
        spots.append(Spot(spot_id, label, round(x, 4), round(y, 4)))
    return spots


def nearest_spot(
    p: Planchette, spots: list[Spot], blocked: frozenset[str] | set[str] = frozenset()
) -> tuple[Spot | None, float]:
    best: Spot | None = None
    best_d = math.inf
    for s in spots:
        if s.id in blocked:
            continue
        d = math.hypot(s.x - p.x, s.y - p.y)
        if d < best_d:
            best, best_d = s, d
    return best, best_d


def step(
    p: Planchette,
    force: tuple[float, float],
    dt: float,
    spots: list[Spot],
    blocked: frozenset[str] | set[str] = frozenset(),
) -> str | None:
    """Advances the planchette by dt seconds.

    Args:
      blocked: spot ids the planchette can't rest on (Salt Circle).

    Returns:
      The id of the spot the planchette locked onto, or None if it hasn't
      locked yet.
    """
    fx, fy = force
    p.fx, p.fy = fx, fy

    p.vx += (fx * ACCEL - p.vx * DRAG) * dt
    p.vy += (fy * ACCEL - p.vy * DRAG) * dt
    speed = math.hypot(p.vx, p.vy)
    if speed > MAX_SPEED:
        p.vx *= MAX_SPEED / speed
        p.vy *= MAX_SPEED / speed

    p.x += p.vx * dt
    p.y += p.vy * dt

    # Keep it on the board; kill velocity into the wall.
    if p.x < EDGE_MARGIN:
        p.x, p.vx = EDGE_MARGIN, max(0.0, p.vx)
    elif p.x > BOARD_W - EDGE_MARGIN:
        p.x, p.vx = BOARD_W - EDGE_MARGIN, min(0.0, p.vx)
    if p.y < EDGE_MARGIN:
        p.y, p.vy = EDGE_MARGIN, max(0.0, p.vy)
    elif p.y > BOARD_H - EDGE_MARGIN:
        p.y, p.vy = BOARD_H - EDGE_MARGIN, min(0.0, p.vy)

    spot, dist = nearest_spot(p, spots, blocked)
    if spot is not None and dist <= SPOT_RADIUS:
        if spot.id == p.hover_spot:
            p.hover_time += dt
        else:
            p.hover_spot, p.hover_time = spot.id, dt
    else:
        p.hover_spot, p.hover_time = None, 0.0

    if p.hover_spot is not None and p.hover_time >= LOCK_SECONDS:
        return p.hover_spot
    return None
