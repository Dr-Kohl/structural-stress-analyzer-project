import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"tools"))
from probe_core import LineAssembler, SessionLog, prepare_payload, transmit_once, visible

class FakePort:
    def __init__(self, count=None, error=None):
        self.calls=[]
        self.count=count
        self.error=error
    def write(self,data):
        self.calls.append(data)
        if self.error:raise self.error
        return len(data) if self.count is None else self.count

class ProbeTests(unittest.TestCase):
    def setUp(self):
        directory=ROOT/"work"/"probe-tests"
        directory.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=directory)
        self.addCleanup(self.temp.cleanup)

    def test_exact_ascii_and_explicit_terminators(self):
        self.assertEqual(prepare_payload("C"),b"C")
        self.assertEqual(prepare_payload(r"MI020\r"),b"MI020\r")
        self.assertEqual(prepare_payload("MI020",ending="CR"),b"MI020\r")
        self.assertEqual(prepare_payload(r"\x43\r"),b"C\r")
        self.assertEqual(prepare_payload("43 0d",mode="Hex"),b"C\r")
        self.assertEqual(visible(b"H\r\n\x00"),r"H\r\n\x00")

    def test_test_command_blocked_for_all_encodings(self):
        for text,mode in [("T","ASCII"),(r"\x54","ASCII"),("54","Hex"),("43 54 0d","Hex"),("STOP","ASCII")]:
            with self.subTest(text=text):
                with self.assertRaisesRegex(ValueError,"Blocked"):
                    prepare_payload(text,mode)

    def test_invalid_or_unbounded_input_rejected(self):
        for text,mode in [("","ASCII"),("A"*33,"ASCII"),("4","Hex"),("gg","Hex"),
                          (r"\q","ASCII"),("é","ASCII"),("\\","ASCII")]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):prepare_payload(text,mode)

    def test_exact_capture_records_survive_every_boundary(self):
        data=(ROOT/"evidence/2026-11-17/ssa1000-device-to-host.txt").read_bytes()
        expected=data.split(b"\r")[:-1]
        self.assertEqual(len(data),1445)
        for split in range(len(data)+1):
            assembler=LineAssembler()
            actual=assembler.feed(data[:split])+assembler.feed(data[split:])
            self.assertEqual(actual,expected)
            self.assertEqual(assembler.pending,b"")
        assembler=LineAssembler()
        self.assertEqual(assembler.feed(b"unknown\r0043,"),[b"unknown"])
        self.assertEqual(assembler.pending,b"0043,")

    def test_logs_exact_bytes_and_never_claims_acknowledgment(self):
        logger=SessionLog(self.temp.name,"test",{"hardware_opened":False})
        port=FakePort()
        self.assertEqual(transmit_once(port,logger,b"C"),1)
        logger.event("rx",b"C\r")
        path=logger.path
        logger.close()
        rows=[json.loads(line) for line in path.read_text().splitlines()]
        self.assertEqual([r["event"] for r in rows],["session","tx_attempt","tx_result","rx"])
        self.assertEqual(rows[1]["hex"],"43")
        self.assertFalse(rows[2]["acknowledged_by_tester"])
        self.assertEqual(bytes.fromhex(rows[3]["hex"]),b"C\r")
        self.assertEqual(port.calls,[b"C"])

    def test_partial_write_is_not_retried(self):
        with SessionForTest(self.temp.name) as logger:
            port=FakePort(count=1)
            with self.assertRaisesRegex(OSError,"Partial"):
                transmit_once(port,logger,b"MI020\r")
            self.assertEqual(port.calls,[b"MI020\r"])

    def test_write_exception_is_not_retried_or_labeled_success(self):
        with SessionForTest(self.temp.name) as logger:
            port=FakePort(error=TimeoutError("timeout"))
            with self.assertRaises(TimeoutError):transmit_once(port,logger,b"C")
            self.assertEqual(port.calls,[b"C"])
            rows=[json.loads(line) for line in logger.path.read_text().splitlines()]
            self.assertEqual(rows[-1]["event"],"tx_error")
            self.assertIn("unknown",rows[-1]["delivery"])

    def test_log_failure_prevents_any_write(self):
        class BrokenLog:
            def event(self,*args,**kwargs):raise OSError("disk unavailable")
        port=FakePort()
        with self.assertRaises(OSError):transmit_once(port,BrokenLog(),b"C")
        self.assertEqual(port.calls,[])

    def test_transport_enforces_t_block_without_ui(self):
        with SessionForTest(self.temp.name) as logger:
            port=FakePort()
            with self.assertRaises(ValueError):transmit_once(port,logger,b"T")
            self.assertEqual(port.calls,[])

class SessionForTest:
    def __init__(self,directory):self.log=SessionLog(directory,"test")
    def __enter__(self):return self.log
    def __exit__(self,*args):self.log.close()

if __name__=="__main__":unittest.main()
