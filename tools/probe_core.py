"""Exact-byte helpers for the SSA diagnostic console. No hardware imports."""
import json
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

MAX_TX_BYTES = 32

def visible(data):
    return "".join(
        {13: r"\r", 10: r"\n", 9: r"\t", 92: r"\\"}.get(
            byte, chr(byte) if 32 <= byte <= 126 else f"\\x{byte:02x}"
        ) for byte in data
    )

def prepare_payload(text, mode="ASCII", ending="None"):
    if mode == "Hex":
        compact = "".join(text.split())
        if not compact or len(compact) % 2 or re.fullmatch(r"[0-9a-fA-F]+", compact) is None:
            raise ValueError("Hex input must contain complete byte pairs, e.g. 43 or 43 0d.")
        payload = bytes.fromhex(compact)
    elif mode == "ASCII":
        result = bytearray()
        i = 0
        while i < len(text):
            char = text[i]
            if char == "\\":
                if i + 1 >= len(text):
                    raise ValueError("An unfinished backslash escape is not a command.")
                escape = text[i + 1]
                if escape in {"r": 13, "n": 10, "t": 9, "\\": 92}:
                    result.append({"r": 13, "n": 10, "t": 9, "\\": 92}[escape])
                    i += 2
                    continue
                if escape == "x" and re.fullmatch(r"[0-9a-fA-F]{2}", text[i+2:i+4] or ""):
                    result.append(int(text[i+2:i+4], 16))
                    i += 4
                    continue
                raise ValueError("Use only \\r, \\n, \\t, \\\\, or \\xHH escapes.")
            if not 32 <= ord(char) <= 126:
                raise ValueError("Use printable ASCII or explicit escapes.")
            result.append(ord(char))
            i += 1
        payload = bytes(result)
    else:
        raise ValueError("Unknown input format.")
    endings = {"None": b"", "CR": b"\r", "LF": b"\n", "CRLF": b"\r\n"}
    if ending not in endings:
        raise ValueError("Unknown line ending.")
    payload += endings[ending]
    if not payload:
        raise ValueError("Enter a command first.")
    if len(payload) > MAX_TX_BYTES:
        raise ValueError(f"Send at most {MAX_TX_BYTES} bytes in one manual action.")
    # The operator explicitly excluded T. Apply the rule to decoded bytes,
    # regardless of ASCII, escape, hex, or multi-byte input.
    if b"T" in payload:
        raise ValueError("Blocked: byte 54 (ASCII T) was associated with starting a test.")
    return payload

class LineAssembler:
    """Preserve CR records and unfinished bytes; do not assume read boundaries."""
    def __init__(self):
        self.pending = bytearray()

    def feed(self, data):
        self.pending.extend(data)
        lines = []
        while 13 in self.pending:
            end = self.pending.index(13)
            lines.append(bytes(self.pending[:end]))
            del self.pending[:end+1]
        return lines

class SessionLog:
    """JSONL is authoritative; append and flush exact payload hex before display."""
    def __init__(self, directory, kind="live", metadata=None):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        self.path = directory / f"ssa-{kind}-{stamp}.jsonl"
        self._file = self.path.open("x", encoding="utf-8", newline="\n")
        self._lock = threading.Lock()
        self._start = time.monotonic()
        self._closed = False
        self.event("session", kind=kind, **(metadata or {}))

    def event(self, event, data=None, **fields):
        row = {
            "utc": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "elapsed_s": round(time.monotonic() - self._start, 6),
            "event": event,
        }
        if data is not None:
            row.update(hex=data.hex(), text=visible(data), byte_count=len(data))
        row.update(fields)
        with self._lock:
            if self._closed:
                raise OSError("Session log is closed.")
            self._file.write(json.dumps(row, ensure_ascii=True) + "\n")
            self._file.flush()
        return row

    def close(self):
        with self._lock:
            if not self._closed:
                self._file.close()
                self._closed = True

def transmit_once(port, logger, payload):
    """Log intent before write. Never retry after partial or uncertain delivery."""
    if b"T" in payload or not 1 <= len(payload) <= MAX_TX_BYTES:
        raise ValueError("Blocked payload.")
    logger.event("tx_attempt", payload)
    try:
        count = port.write(payload)
    except Exception as error:
        logger.event("tx_error", payload, delivery="unknown; do not retry automatically",
                     error=str(error))
        raise
    logger.event("tx_result", payload[:count] if isinstance(count, int) else b"",
                 requested_bytes=len(payload), reported_written=count,
                 acknowledged_by_tester=False)
    if count != len(payload):
        raise OSError(f"Partial or unknown write ({count}/{len(payload)}). No retry was made.")
    return count
