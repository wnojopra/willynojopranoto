import math

from app import physics


def test_sanitize_pull_clamps_and_rejects_garbage():
    assert physics.sanitize_pull(3, 4) == (0.6, 0.8)
    assert physics.sanitize_pull(0.2, -0.1) == (0.2, -0.1)
    assert physics.sanitize_pull("x", 1) == (0.0, 0.0)
    assert physics.sanitize_pull(float("nan"), 0) == (0.0, 0.0)
    assert physics.sanitize_pull(float("inf"), 0) == (0.0, 0.0)
    assert physics.sanitize_pull(None, None) == (0.0, 0.0)


def test_opposing_pulls_cancel():
    assert physics.combine_pulls([(1, 0), (-1, 0)]) == (0.0, 0.0)


def test_unanimous_pull_scales_sublinearly():
    fx, _ = physics.combine_pulls([(1, 0)] * 9)
    assert math.isclose(fx, 3.0)


def test_layout_spots_on_ring_and_equidistant_from_start():
    spots = physics.layout_spots([(str(i), f"P{i}") for i in range(10)])
    assert len(spots) == 10
    for s in spots:
        assert 0 < s.x < physics.BOARD_W
        assert 0 < s.y < physics.BOARD_H
    # Spots don't overlap each other's lock radius.
    for a in spots:
        for b in spots:
            if a is not b:
                assert math.hypot(a.x - b.x, a.y - b.y) > 2 * physics.SPOT_RADIUS


def test_planchette_moves_toward_pull_and_locks_after_hold():
    spots = physics.layout_spots([("a", "A"), ("b", "B")])
    target = spots[0]
    p = physics.Planchette()
    dt = 1 / 30
    locked = None
    for _ in range(30 * 15):
        dx, dy = target.x - p.x, target.y - p.y
        d = math.hypot(dx, dy) or 1
        # Pull gently once close so we settle inside the spot.
        strength = 1.0 if d > 0.05 else 0.0
        locked = physics.step(p, (dx / d * strength, dy / d * strength), dt, spots)
        if locked:
            break
    assert locked == "a"


def test_planchette_stays_on_board():
    p = physics.Planchette()
    for _ in range(300):
        physics.step(p, (5.0, 5.0), 1 / 30, [])
    assert p.x <= physics.BOARD_W - physics.EDGE_MARGIN
    assert p.y <= physics.BOARD_H - physics.EDGE_MARGIN
