# Structural Stress Analyzer Project

A replacement interface and data logger for the Structural Stress Analyzer 1000.

The immediate aim is to preserve the captured protocol and test data, then build an offline replay and plotting interface before testing a replacement connection to the instrument.

## Current state

- Local Git repository; no remote or GitHub repository configured.
- Original startup capture and one destructive sample-test capture preserved.
- 144 measurement records reconstructed from the serial stream.
- Peak of 114 lb at 0.043 in matches the operator's displayed result.
- No replacement software has connected to or commanded the tester.
- No application implementation has been added yet.

## Connection and protocol findings

The instrument appears as a Prolific USB serial adapter (observed COM4, VID 067B, PID 23A3). The final captured application configuration is **9600 baud, 8 data bits, no parity, 1 stop bit**.

| Observed exchange | Computer sends | Instrument returns |
| --- | --- | --- |
| Startup | ASCII H, without a line ending | U followed by CR, then H followed by CR |
| Recorded test | ASCII T, without a line ending | D followed by CR, numeric records, then TT followed by CR |

A numeric record such as `0043,0114\r` corresponds to 0.043 inches and 114 pounds. The first integer is divided by 1000 to interpret displacement in inches. Each observed record ends with CR (0x0D).

The precise physical effects of H and T have not been isolated. Stop, calibration, configuration, and other machine operations remain unverified. Do not implement a machine Stop button using a guessed command.

## Preserved evidence

All evidence lives in [evidence/2026-11-17](evidence/2026-11-17/).

- [Protocol analysis](evidence/2026-11-17/ssa1000-protocol-analysis.txt): settings, exact exchanges, packet references, timing, limitations, and next steps.
- [Startup capture](evidence/2026-11-17/ssa1000-startup.pcapng): 353 packets.
- [Sample test capture](evidence/2026-11-17/ssa1000-sample-break-2026-11-17.pcapng): 2,913 packets, zero reported drops.
- [Recovered measurements](evidence/2026-11-17/ssa1000-recovered-measurements.csv): values, USB receive times, and packet references.
- [Exact incoming serial stream](evidence/2026-11-17/ssa1000-device-to-host.txt) and [outgoing stream](evidence/2026-11-17/ssa1000-host-to-device.txt).
- [Graph and export-error screenshot](evidence/2026-11-17/ssa1000-test-screen-and-export-error.png).
- Packet-level TSV exports, preservation notes, and SHA-256 manifests.

Evidence files are copied byte for byte from the preserved session outputs. Git line-ending conversion is disabled for the evidence directory so the recorded checksums remain valid. The earlier ZIP bundle is not duplicated inside Git; its individual contents are tracked.

The CSV was reconstructed from USB traffic. It is not an SSA-generated export. The old application showed a file-opening error while attempting to export to a path at the root of C:.

## Next development steps

1. Replay the saved stream offline and reproduce the force/displacement curve.
2. Handle arbitrary serial-read chunk sizes, CR-delimited records, marker records, and malformed input without losing raw bytes.
3. Add raw-session logging and reliable measurement export.
4. Add a Web Serial connection using the existing Windows adapter driver.
5. Verify connection signals and command behavior under operator-controlled conditions before enabling machine control.

Direct browser communication appears feasible with Web Serial in Chrome on Windows. See [Chrome's Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial).

## Before a public release

The repository currently preserves the original evidence, including computer paths, USB device identifiers, and a screenshot of the vendor's software. Review these before publishing and consider whether public evidence should be redacted or replaced by a synthetic fixture. This repository does not include the vendor's executable or installer.

No open-source license has been selected yet.

## Local workflow

```powershell
git status
git log --oneline
git add <specific changed files>
git commit -m "Describe the change"
```

Keep the original evidence unchanged. Put derived analyses and generated results in new files. A GitHub remote can be added later when publication is requested.
