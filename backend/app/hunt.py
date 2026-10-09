"""Scavenger hunt: clue codes, claims, and each phone's Relic collection.

Design doc §6.5. The host prints QR stickers (one per clue). Scanning one opens
/claim/<token>; the first phone to claim it gets the Relic, saved under that
phone's device id (an HttpOnly cookie, see main.py). When the phone joins a
game, its unspent hunt Relics come along; spending one in a game removes it here.

Two stores with the same interface:
- FirestoreStore: production (claims happen hours before the game, and Cloud
  Run instances come and go).
- MemoryStore: local dev and tests.
"""

from __future__ import annotations

import asyncio
import logging
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Protocol

from app import questions, relics

log = logging.getLogger("spiritboard.hunt")

TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{16}")
QUESTION_ID_RE = re.compile(r"[A-Za-z0-9_-]{12}")
DEVICE_RE = re.compile(r"[A-Za-z0-9_-]{43}")
LABEL_MAX = 40
MAX_BATCH = 100
MAX_CODES = 500
MAX_RELICS_PER_DEVICE = 50
TIERS = ("common", "rare", "cursed")
ANY_TIER = "any"

_sysrand = secrets.SystemRandom()


def new_token() -> str:
    """16 URL-safe chars (96 bits): unguessable, and short enough for a QR sticker."""
    return secrets.token_urlsafe(12)


def new_device_id() -> str:
    return secrets.token_urlsafe(32)


def valid_token(raw: object) -> bool:
    return isinstance(raw, str) and TOKEN_RE.fullmatch(raw) is not None


def valid_question_id(raw: object) -> bool:
    return isinstance(raw, str) and QUESTION_ID_RE.fullmatch(raw) is not None


def valid_device(raw: object) -> bool:
    return isinstance(raw, str) and DEVICE_RE.fullmatch(raw) is not None


def clean_label(raw: object) -> str:
    """The host's note for a sticker ("fridge", "under the stairs"). Plain text only."""
    if not isinstance(raw, str):
        return ""
    text = "".join(ch for ch in raw if ch.isprintable()).strip()
    return text[:LABEL_MAX]


def validate_prize(relic: object, tier: object) -> tuple[str | None, str | None]:
    """A code gives a set Relic, or a random one from a tier (or any tier)."""
    if relic is not None:
        if not isinstance(relic, str) or relic not in relics.CATALOG:
            raise ValueError("Unknown Relic.")
        return relic, None
    if tier not in (*TIERS, ANY_TIER):
        raise ValueError("Pick a Relic or a tier.")
    return None, tier  # type: ignore[return-value]


def roll_prize(relic: str | None, tier: str | None) -> str:
    if relic is not None:
        return relic
    if tier == ANY_TIER or tier is None:
        return relics.starter_relic(_sysrand)
    pool = [r.key for r in relics.CATALOG.values() if r.tier == tier]
    return _sysrand.choice(pool)


@dataclass
class Code:
    token: str
    label: str
    relic: str | None  # set Relic, or None to roll from `tier` when claimed
    tier: str | None
    created_at: float
    claimed_by: str | None = None  # device id (never sent to clients)
    claimed_name: str | None = None
    claimed_relic: str | None = None
    claimed_at: float | None = None

    def to_admin_dict(self) -> dict:
        return {
            "token": self.token,
            "label": self.label,
            "relic": self.relic,
            "tier": self.tier,
            "createdAt": self.created_at,
            "claimed": self.claimed_by is not None,
            "claimedName": self.claimed_name,
            "claimedRelic": self.claimed_relic,
            "claimedAt": self.claimed_at,
        }

    def to_doc(self) -> dict:
        return {
            "label": self.label,
            "relic": self.relic,
            "tier": self.tier,
            "createdAt": self.created_at,
            "claimedBy": self.claimed_by,
            "claimedName": self.claimed_name,
            "claimedRelic": self.claimed_relic,
            "claimedAt": self.claimed_at,
        }

    @classmethod
    def from_doc(cls, token: str, d: dict) -> Code:
        return cls(
            token=token,
            label=d.get("label", ""),
            relic=d.get("relic"),
            tier=d.get("tier"),
            created_at=d.get("createdAt", 0.0),
            claimed_by=d.get("claimedBy"),
            claimed_name=d.get("claimedName"),
            claimed_relic=d.get("claimedRelic"),
            claimed_at=d.get("claimedAt"),
        )


@dataclass
class Device:
    name: str | None = None
    relics: list[str] = field(default_factory=list)  # unspent hunt Relics


@dataclass
class ClaimResult:
    # claimed: you just got it · yours: you already claimed it · taken: someone else did
    # invalid: no such code · need_name: tell us your name first · full: collection full
    # unclaimed: (peek only) up for grabs and we know your name
    status: str
    relic: str | None = None


def _claim_logic(code: Code | None, dev: Device, device: str, name: str | None) -> tuple[ClaimResult, bool]:
    """Pure claim rules shared by both stores. Returns (result, changed)."""
    if code is None:
        return ClaimResult("invalid"), False
    if code.claimed_by == device:
        return ClaimResult("yours", code.claimed_relic), False
    if code.claimed_by is not None:
        return ClaimResult("taken"), False
    if dev.name is None and name is None:
        return ClaimResult("need_name"), False
    if len(dev.relics) >= MAX_RELICS_PER_DEVICE:
        return ClaimResult("full"), False
    if dev.name is None:
        dev.name = name
    prize = roll_prize(code.relic, code.tier)
    code.claimed_by = device
    code.claimed_name = dev.name
    code.claimed_relic = prize
    code.claimed_at = time.time()
    dev.relics.append(prize)
    return ClaimResult("claimed", prize), True


@dataclass
class CustomQuestion:
    """A host-written question (design doc §5.3). Validated by questions.clean_custom."""

    id: str
    deck: str  # bets | medium | final
    kind: str  # who | yesno | pick
    text: str
    options: tuple[str, ...]
    always: bool
    created_at: float

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "deck": self.deck,
            "kind": self.kind,
            "text": self.text,
            "options": list(self.options),
            "always": self.always,
            "createdAt": self.created_at,
        }

    def to_doc(self) -> dict:
        d = self.to_dict()
        d.pop("id")
        return d

    @classmethod
    def from_doc(cls, qid: str, d: dict) -> "CustomQuestion":
        return cls(
            qid,
            d.get("deck", "bets"),
            d.get("kind", "who"),
            d.get("text", ""),
            tuple(d.get("options", ())),
            bool(d.get("always", False)),
            float(d.get("createdAt", 0.0)),
        )

    def to_question(self) -> questions.Question:
        return questions.Question(self.kind, self.text, self.options)


def new_question(deck: object, kind: object, text: object, options: object, always: object) -> CustomQuestion:
    d, k, t, opts = questions.clean_custom(deck, kind, text, options)
    return CustomQuestion(secrets.token_urlsafe(9), d, k, t, opts, always is True, time.time())


class HuntStore(Protocol):
    async def create_codes(self, count: int, label: str, relic: str | None, tier: str | None) -> list[Code]: ...
    async def list_codes(self) -> list[Code]: ...
    async def delete_code(self, token: str) -> bool: ...
    async def peek(self, token: str, device: str | None) -> ClaimResult: ...
    async def claim(self, token: str, device: str, name: str | None) -> ClaimResult: ...
    async def get_device(self, device: str) -> Device: ...
    async def consume(self, device: str, key: str) -> bool: ...
    async def list_questions(self) -> list[CustomQuestion]: ...
    async def add_question(self, q: CustomQuestion) -> None: ...
    async def set_question_always(self, qid: str, always: bool) -> bool: ...
    async def delete_question(self, qid: str) -> bool: ...


class MemoryStore:
    """In-process store for local dev and tests. Lost on restart."""

    def __init__(self) -> None:
        self.codes: dict[str, Code] = {}
        self.devices: dict[str, Device] = {}
        self.questions: dict[str, CustomQuestion] = {}
        self._lock = asyncio.Lock()

    async def create_codes(self, count: int, label: str, relic: str | None, tier: str | None) -> list[Code]:
        async with self._lock:
            if len(self.codes) + count > MAX_CODES:
                raise ValueError(f"That would be more than {MAX_CODES} codes.")
            now = time.time()
            made = [Code(new_token(), label, relic, tier, now + i * 1e-6) for i in range(count)]
            for c in made:
                self.codes[c.token] = c
            return made

    async def list_codes(self) -> list[Code]:
        return sorted(self.codes.values(), key=lambda c: c.created_at)

    async def delete_code(self, token: str) -> bool:
        async with self._lock:
            return self.codes.pop(token, None) is not None

    async def peek(self, token: str, device: str | None) -> ClaimResult:
        code = self.codes.get(token)
        if code is None:
            return ClaimResult("invalid")
        if device is not None and code.claimed_by == device:
            return ClaimResult("yours", code.claimed_relic)
        if code.claimed_by is not None:
            return ClaimResult("taken")
        dev = self.devices.get(device or "")
        return ClaimResult("unclaimed" if dev and dev.name else "need_name")

    async def claim(self, token: str, device: str, name: str | None) -> ClaimResult:
        async with self._lock:
            dev = self.devices.get(device) or Device()
            result, changed = _claim_logic(self.codes.get(token), dev, device, name)
            if changed:
                self.devices[device] = dev
            return result

    async def get_device(self, device: str) -> Device:
        dev = self.devices.get(device)
        return Device(dev.name, list(dev.relics)) if dev else Device()

    async def consume(self, device: str, key: str) -> bool:
        async with self._lock:
            dev = self.devices.get(device)
            if dev is None or key not in dev.relics:
                return False
            dev.relics.remove(key)
            return True

    async def list_questions(self) -> list[CustomQuestion]:
        return sorted(self.questions.values(), key=lambda q: q.created_at)

    async def add_question(self, q: CustomQuestion) -> None:
        async with self._lock:
            if len(self.questions) >= questions.MAX_CUSTOM:
                raise ValueError(f"That's the limit ({questions.MAX_CUSTOM} questions).")
            self.questions[q.id] = q

    async def set_question_always(self, qid: str, always: bool) -> bool:
        q = self.questions.get(qid)
        if q is None:
            return False
        q.always = always
        return True

    async def delete_question(self, qid: str) -> bool:
        async with self._lock:
            return self.questions.pop(qid, None) is not None


class FirestoreStore:
    """Firestore-backed store. Collections: `codes/{token}`, `devices/{deviceId}`, `questions/{id}`."""

    def __init__(self, project: str | None, database: str) -> None:
        from google.cloud import firestore  # imported lazily: only needed in production

        self._fs = firestore
        self._db = firestore.AsyncClient(project=project, database=database)
        self._codes = self._db.collection("codes")
        self._devices = self._db.collection("devices")
        self._questions = self._db.collection("questions")

    async def create_codes(self, count: int, label: str, relic: str | None, tier: str | None) -> list[Code]:
        existing = await self._codes.count().get()
        total = existing[0][0].value if existing and existing[0] else 0
        if total + count > MAX_CODES:
            raise ValueError(f"That would be more than {MAX_CODES} codes.")
        now = time.time()
        made = [Code(new_token(), label, relic, tier, now + i * 1e-6) for i in range(count)]
        batch = self._db.batch()
        for c in made:
            batch.create(self._codes.document(c.token), c.to_doc())
        await batch.commit()
        return made

    async def list_codes(self) -> list[Code]:
        out = [Code.from_doc(snap.id, snap.to_dict() or {}) async for snap in self._codes.stream()]
        return sorted(out, key=lambda c: c.created_at)

    async def delete_code(self, token: str) -> bool:
        ref = self._codes.document(token)
        if not (await ref.get()).exists:
            return False
        await ref.delete()
        return True

    async def peek(self, token: str, device: str | None) -> ClaimResult:
        snap = await self._codes.document(token).get()
        if not snap.exists:
            return ClaimResult("invalid")
        code = Code.from_doc(token, snap.to_dict() or {})
        if device is not None and code.claimed_by == device:
            return ClaimResult("yours", code.claimed_relic)
        if code.claimed_by is not None:
            return ClaimResult("taken")
        dev = await self.get_device(device) if device else Device()
        return ClaimResult("unclaimed" if dev.name else "need_name")

    async def claim(self, token: str, device: str, name: str | None) -> ClaimResult:
        code_ref = self._codes.document(token)
        dev_ref = self._devices.document(device)

        @self._fs.async_transactional
        async def txn(transaction) -> ClaimResult:
            code_snap = await code_ref.get(transaction=transaction)
            dev_snap = await dev_ref.get(transaction=transaction)
            code = Code.from_doc(token, code_snap.to_dict() or {}) if code_snap.exists else None
            d = (dev_snap.to_dict() or {}) if dev_snap.exists else {}
            dev = Device(d.get("name"), list(d.get("relics", [])))
            result, changed = _claim_logic(code, dev, device, name)
            if changed and code is not None:
                transaction.update(code_ref, code.to_doc())
                transaction.set(dev_ref, {"name": dev.name, "relics": dev.relics, "updatedAt": time.time()})
            return result

        return await txn(self._db.transaction())

    async def get_device(self, device: str) -> Device:
        snap = await self._devices.document(device).get()
        if not snap.exists:
            return Device()
        d = snap.to_dict() or {}
        return Device(d.get("name"), list(d.get("relics", [])))

    async def consume(self, device: str, key: str) -> bool:
        dev_ref = self._devices.document(device)

        @self._fs.async_transactional
        async def txn(transaction) -> bool:
            snap = await dev_ref.get(transaction=transaction)
            if not snap.exists:
                return False
            have = list((snap.to_dict() or {}).get("relics", []))
            if key not in have:
                return False
            have.remove(key)
            transaction.update(dev_ref, {"relics": have, "updatedAt": time.time()})
            return True

        return await txn(self._db.transaction())

    async def list_questions(self) -> list[CustomQuestion]:
        out = [CustomQuestion.from_doc(snap.id, snap.to_dict() or {}) async for snap in self._questions.stream()]
        return sorted(out, key=lambda q: q.created_at)

    async def add_question(self, q: CustomQuestion) -> None:
        existing = await self._questions.count().get()
        total = existing[0][0].value if existing and existing[0] else 0
        if total >= questions.MAX_CUSTOM:
            raise ValueError(f"That's the limit ({questions.MAX_CUSTOM} questions).")
        await self._questions.document(q.id).create(q.to_doc())

    async def set_question_always(self, qid: str, always: bool) -> bool:
        ref = self._questions.document(qid)
        if not (await ref.get()).exists:
            return False
        await ref.update({"always": always})
        return True

    async def delete_question(self, qid: str) -> bool:
        ref = self._questions.document(qid)
        if not (await ref.get()).exists:
            return False
        await ref.delete()
        return True


def make_store(database: str | None, project: str | None) -> HuntStore:
    if database:
        log.info("hunt store: Firestore database %s", database)
        return FirestoreStore(project, database)
    log.warning("hunt store: in-memory (claims are lost on restart). Set SB_FIRESTORE_DATABASE in production.")
    return MemoryStore()
