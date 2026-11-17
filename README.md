# Structural Stress Analyzer Project

A replacement interface and data logger for the Structural Stress Analyzer 1000.

The immediate aim is to preserve the captured protocol and test data, then build an offline replay and plotting interface before testing a replacement connection to the instrument.

## Current state

- Local Git repository; no remote or GitHub repository configured.
- Original startup capture and one destructive sample-test capture preserved.
- 144 measurement records reconstructed from the serial stream.
- Peak of 114 lb at 0.043 in matches the operator's displayed result.
- No replacement software has connected to or commanded the tester.
- Offline browser replay is implemented and opens directly from index.html; no server, installation, or network connection is required.

## Run the local replay

Open index.html in Microsoft Edge or Chrome, or double-click it in File Explorer. Keep index.html, styles.css, model.js, capture-data.js, and app.js together in this project folder.

The page initially shows all 144 readings. Use Replay test to animate from the beginning, Pause to inspect, Reset to return to the first reading, and the slider to move to any reading. Speed choices are 0.5x, 1x, 2x, and 4x. The initial three-second gap in the capture is retained.

Inspect peak jumps to reading 44: 114 lb at 0.043 in. Hover over the graph to inspect readings. Uncheck Show zero-force tail to focus the horizontal axis on the loaded portion.

Export measurements saves all 144 readings, including raw fields and packet references, regardless of the playback position or chart view. Save graph exports the currently visible graph as an SVG. The page has no serial connection or machine controls.

### Verify the implementation

With Node.js available, run:

```powershell
node --test tests/model.test.cjs
node --check app.js
```

Checks compare every replay value with the original captured serial stream, exercise every possible two-chunk split plus byte-at-a-time parsing, preserve incomplete and unknown records, check peak/tail/timing, and verify complete CSV output.

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

1. Completed: replay the saved stream offline and reproduce the force/displacement curve.
2. Parser implemented and tested offline: arbitrary chunk sizes, CR records, known markers, and retained unknown/incomplete text. Connect it to a future live reader.
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

## Configuration investigation update

See [the configuration investigation](docs/configuration-investigation.txt) and its preserved capture. Applying Continuous sent C and initially received C followed by CR. Selecting Incremental sent I, received I followed by CR, then sent MI020 followed by CR for the 20 lb setting. The 450/500 global-limit changes sent no numeric limit value.

No serial replies were captured after MI020. Subsequent attempts to set 25/26 sent only I, and the final return to Continuous sent C without a reply. The GUI baseline was restored by the operator; firmware state remains unconfirmed. Re-establish an acknowledged known state before further machine operation.

## Recovery update

After closing SSA and power-cycling the tester, startup H received H followed by CR again. The operator reported the LCD ready to begin a cycle. See [recovery evidence](docs/recovery-after-power-cycle.txt). Communication recovered; the cause of the preceding silence and mode/limit behavior remain unresolved. No new test was started.
