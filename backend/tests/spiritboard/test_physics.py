import math

from app.spiritboard import physics


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


def test_layout_spots_fit_the_ring_for_any_group_size():
    for n in range(2, 17):  # up to rooms.MAX_PLAYERS
        spots = physics.layout_spots([(str(i), f"P{i}") for i in range(n)])
        assert len(spots) == n
        for s in spots:
            assert physics.EDGE_MARGIN < s.x < physics.BOARD_W - physics.EDGE_MARGIN
            assert physics.EDGE_MARGIN < s.y < physics.BOARD_H - physics.EDGE_MARGIN
        # Spots don't overlap each other's lock radius, even with 16 on the ring.
        for a in spots:
            for b in spots:
                if a is not b:
                    assert math.hypot(a.x - b.x, a.y - b.y) > 2 * physics.SPOT_RADIUS, n
        # Spaced evenly along the ring: nobody's nearest neighbour is squeezed much closer
        # than average (equal *angles* squeezed the ends ~26% below the mean at 16).
        gaps = [min(math.hypot(a.x - b.x, a.y - b.y) for b in spots if b is not a) for a in spots]
        assert min(gaps) > 0.8 * (sum(gaps) / n), (n, gaps)
        # Mirror-symmetric left to right, and even sizes leave the top (nearest the start) empty.
        for s in spots:
            assert any(abs(o.x - (2 * physics.START_X - s.x)) < 1e-3 and abs(o.y - s.y) < 1e-3 for o in spots), n
        if n % 2 == 0:
            assert all(abs(s.x - physics.START_X) > 0.05 for s in spots), n
        else:
            assert abs(spots[0].x - physics.START_X) < 1e-3 and spots[0].y < physics.START_Y


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
