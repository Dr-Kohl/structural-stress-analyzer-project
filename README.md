# Structural Stress Analyzer Project

A local workspace and diagnostic tools for replacing the Structural Stress Analyzer 1000 software. The browser workspace supports offline replay and an **experimental live Web Serial interface**. The separate Python investigator has communicated with the tester. Browser controls have been tested with simulated ports; live browser/hardware validation is still required.

## Open the workspace

Open the [browser workspace on GitHub Pages](https://dr-kohl.github.io/structural-stress-analyzer-project/). It runs in your browser with the same replay, import and export features. Imported recordings stay in your browser; the app does not upload them. Browser recovery for the hosted site is separate from recovery for a local file.

Double-click **index.html** in Microsoft Edge or Chrome. Keep the project folder together. No server, installation, internet connection, or build step is needed for the webpage.

The familiar left column contains Settings, Test Config, Home, Start Test, Stop request, Save Data, Disconnect, and Session details. Machine controls stay disabled until an explicit serial connection. **Stop request sends S; stopping behavior is unverified.** It does not replace physical power control.

### What works now

- Replay the original 144 readings with the captured arrival timing, including the initial pause. Pause, reset, change speed, or scrub by reading.
- Inspect the graph or jump to the confirmed **114 lb at 0.043 inches** peak.
- Show/hide the zero-force tail or fit the complete recording. Hiding data on screen never removes it from exports.
- Save session descriptions: name, operator, material, specimen and notes.
- Edit a **local configuration draft** for Continuous, Incremental or Cyclic mode. Applicable fields enable by mode; configuration is never represented as applied to hardware.
- Import the evidence CSV, CR-delimited raw serial text, a complete session archive, or measurement-bearing Python investigator JSONL logs.
- Export every measurement as CSV, the current graph as SVG or PNG, raw evidence as JSON, or a complete reopenable session as JSON.
- Retain a browser recovery copy, with explicit warnings when storage is unavailable or a saved copy is unreadable.
- Preview a nonblocking communication fault while keeping the graph, source data and export controls usable.

The original recording remains in the evidence folder. **Original capture** reloads its unchanged embedded fixture. Browser recovery is local to that browser/profile and file location; it is not a portable backup.

### Saving and opening recordings

Use **Save Data → Complete session** for a portable copy of measurements, descriptions, draft configuration, raw bytes where supplied, and activity. Open it later with **Open data**.

CSV/session exports always contain the full recording. SVG/PNG exports contain the currently revealed graph and chart range.

Browser downloads are available without a file-system API. The page reports **Download requested**, since it cannot confirm the browser's disk write. Where supported, select **Ask where to save** to use a file picker and confirm completion of the chosen file write. Canceling or failing a save leaves the data available.

Supported imports (up to 10 MB and 100,000 readings):

- CSV with `displacement_in` and `force_lb` headers. Optional `time_s`, packet references and raw numeric fields are retained. The original evidence CSV's `first_time_relative_s` is recognized.
- Raw ASCII records in the observed `dddd,ffff\r` format. Exact bytes are retained. An incomplete final record is rejected without replacing the current recording.
- Complete workspace `*.session.json` archives (schema version 1).
- Python investigator `*.jsonl` logs containing RX measurement records. Original log text and raw RX/TX-result bytes are retained, including unfinished tails. Logs without measurement records remain evidence files rather than graphable recordings.

Imported data without timestamps use a clearly labeled paced replay; synthetic pacing is never written into the measurement timestamps. Raw-evidence-only JSON is an evidence export, not a complete reopenable session.

All graph units are **inches and pounds**. Import does not perform unit conversion. The data are force/displacement, not specimen stress/strain. No calibration or material-property calculation is claimed.

## Live instrument use (experimental)

Use the hosted HTTPS page in desktop Chrome or Edge. Close SSA and disconnect Python first. Choose **Connection**, confirm readiness, SAE units, and preservation of the current recording, then select the Prolific adapter. Opening/closing the port can affect control signals and machine state. The user must be beside a clear tester with physical power control available.

Connection uses 9600 8N1, no flow control, with explicit DTR/RTS preferences. It sends **zero startup commands**. No automatic homing, Start, reconnect, or retry occurs. Live mode hides the historical graph until actual live measurements arrive. Incoming `dddd,ffff` records are interpreted as inches/pounds only after the operator confirms SAE units. Timestamps are browser arrival times. Keep the instrument in SAE throughout the connection.

- **Read version** sends bare `V`; observed reply `V4.0\r` is consistent with a version query.
- **Home** sends bare `H` only after its own motion confirmation.
- **Start Test** sends bare `T` only after its own motion confirmation. One Start is permitted per connection; download and reconnect for another test. The user explicitly authorized implementing T on November 18. No browser test has been started on hardware during implementation.
- **Stop request** sends bare `S`. An idle `S\r` reply has been observed; stopping actual motion is **not verified**. A request or reply must never be presented as proof that the machine stopped.
- **Select Continuous** and **Select Incremental only** send bare `C` / `I`. These request the observed mode selections only; they do not apply any numeric fields. No MI020, cyclic command, jog command, calibration command, or guessed parameters are sent.
- **Test Config remains a local draft.** Global maximum force, incremental force, cyclic force and cycle count are not applied or enforced by this page. Start uses the instrument's current settings, which the browser cannot verify.

Live data and exact RX/TX-attempt/result events are retained in browser recovery. **Download live log** preserves a JSONL file even if no measurements arrive; check the browser download completed. Recovery is not a durable disk-write guarantee. A logging failure or a read/write error closes the connection without retry; physical motion may continue. The browser warns before unloading a connected page, but cannot guarantee that a tab or computer stays open.

### Maximum-force event (`TM`)

The wood trial recorded `TM\r` immediately after 37 measurements, alongside the operator's report that the tester displayed maximum force exceeded. The last transmitted reading was **994 lb at 0.035 in**; that is not proof of the exact trip force or configured threshold. `TT\r` remains the distinct normal test-end marker.

Receiving a complete `TM\r` now records a force-limit result, shows a persistent warning with the last transmitted reading, and releases the pending-test guard so **Home can be explicitly requested with its motion confirmation**. No Home, Stop, retry or reconnect is sent automatically. Start remains limited to one request per connection. The warning survives later S/version replies and disconnect; the result is retained in the JSONL log and exported/recovered session description. Neither TM nor a later S reply proves the specimen is unloaded or motion has stopped. This change does not implement or validate the lower force cutoff.

When disconnected, choose **Review recording** to use replay/import controls again. Complete-session, CSV, raw evidence and chart exports work with received measurements; the complete live log retains nonmeasurement replies and unfinished byte tails. A recovered log can be downloaded on the next visit without opening hardware. New connections require the device picker and readiness checks again. A new browser profile/device does not share recovery.

The live recorder limits a connection to 2 MB of raw incoming bytes, 100,000 readings and 4 KB of pending unterminated text. Browser storage may fill sooner; save sessions regularly. HTTP requests do not upload imported/live measurements; communication goes through the operator-selected local serial port.

### Observed stop/return sequence (`TU` then `H`)

In the saved brief Stop trial, the browser sent `T`, then `S`. The tester sent `TU\r`, followed by `H\r`, without a browser Home command. The operator observed motion stop and apparently return home. Only one zero-force measurement was recorded, so significant-load stopping, guaranteed latency and emergency-stop performance remain unverified. The full firmware meaning of TU is not documented; its classification follows this observed sequence.

The page now shows **Stop/return sequence recorded**, keeps Home and mode changes blocked while awaiting the separate Home reply, then records **Home reply received**. A plain `S\r` alone does not clear the pending-test guard. The page never sends Home automatically. A disconnect before H is shown as an unknown return outcome. Another Start still requires a fresh connection; verify physical position and load before interacting with the fixture. Both the sequence and Home report survive log/session export and browser recovery. An earlier maximum-force warning is retained if both events occur in a connection.

See [the exact chronology and limitations](evidence/2026-11-18/active-stop-return-home-findings.txt).

## Verification

Data/model tests need Node.js:

```powershell
node --test tests/model.test.cjs tests/workspace.test.cjs tests/live.test.cjs
node --check app.js
```

These compare the original data and exact serial bytes, preserve repeated positions and tail readings, test stream chunk boundaries, validate configuration, round-trip sessions/CSV, reject invalid files, and check chart ranges.

An optional end-to-end check uses Playwright and a fresh **headless** Edge profile:

```powershell
node tests/browser-check.cjs
node tests/live-browser-check.cjs
```

Playwright must be available through normal module resolution or `NODE_PATH`; `SSA_BROWSER_PATH` can override the default Windows Edge executable. Browser checks cover dialogs, draft fields, recovery/reload, all graph/session exports, imports and malformed files, replay completion, storage/save failures, corrupted recovery preservation, and 1366/768/375/320 px layouts. They reject instrument API access and check for external HTTP requests. Screenshots and downloaded checks go under ignored `work/browser-check/`.

## Python command investigator

Double-click **launch-investigator.cmd** for the separate diagnostic window. Instructions: [docs/python-investigator.txt](docs/python-investigator.txt).

It starts disconnected, previews exact bytes, sends only an explicitly chosen message, blocks ASCII T in every input format, and logs TX attempts/results and RX chunks. There is no automatic startup command, alphabet sweep or retry after uncertain delivery. Its offline replay uses the real captured stream.

pySerial 3.5 is installed in the ignored project `.venv` environment. Nine hardware-free tests are available:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -p test_probe.py -v
```

Transient logs go under ignored `sessions/`. After an informative experiment, inspect, copy, hash and commit selected logs into a new evidence session. The Python console was exercised against the real instrument on November 18; see the new evidence and findings below.

## Preserved evidence and current findings

See [the original evidence](evidence/2026-11-17/), [November 18 Python findings](evidence/2026-11-18/first-live-python-investigation.txt), [the idle Stop capture attempt](evidence/2026-11-18/idle-stop-attempt.txt), and [the next-session handoff](docs/next-session.txt).

- Original startup capture (353 packets) and sample-break capture (2,913 packets, zero reported drops).
- All 144 reconstructed readings, exact test serial streams, packet exports, original screenshots, and SHA-256 manifests.
- Configuration investigation (97 packets) and successful recovery capture (65 packets).
- [Protocol analysis](evidence/2026-11-17/ssa1000-protocol-analysis.txt), [configuration findings](docs/configuration-investigation.txt), [recovery findings](docs/recovery-after-power-cycle.txt), and [installed software/manual investigation](docs/installed-software-investigation.txt).

Observed connection: Prolific USB serial adapter (COM4 during capture, VID 067B / PID 23A3), final application setting **9600 8N1**.

| Operation in the original software | Observed bytes |
| --- | --- |
| Startup | H; replies U + CR then H + CR when homing, or H + CR when already home |
| Recorded sample test | T; replies D + CR, decimal measurement records, TT + CR |
| Continuous configuration | C; initially replied C + CR |
| Initial Incremental selection | I; replied I + CR, then SSA sent MI020 + CR |

**Unresolved:** no serial replies appeared after MI020. Attempts at 25/26 only sent I; MI025 and MI026 were never captured. The final C was unacknowledged. Closing SSA and power-cycling the tester restored H → H + CR, without establishing the cause. Global 450/500 changes only sent C; ownership/enforcement of the limit remains unverified. Stop/abort, cyclic commands, calibration and full command semantics remain unknown.

The [final webpage plan](docs/final-webpage-plan.txt) describes the intended live interface. The familiar layout and experimental Web Serial implementation are now present; browser connection and machine actions still require hardware validation with the operator present. Numeric live configuration remains unavailable. No hardware access is needed to continue work on offline features.

## Local Git and public release

The public repository is [Dr-Kohl/structural-stress-analyzer-project](https://github.com/Dr-Kohl/structural-stress-analyzer-project). Project source, selected evidence and their Git history are preserved locally and published on the `main` branch. Do not change original evidence; its directory disables line-ending conversion to preserve hashes.

The vendor PDFs are saved separately beside the project in `ssa1000-reference-manuals`. The executable and installer remain outside Git.

The publication review checked tracked files and history for credential signatures and accidentally included runtime/session-log files. Selected evidence includes original USB identifiers, local paths and vendor screenshots. No open-source license has been selected.

```powershell
git status
git log --oneline
git add <specific changed files>
git commit -m "Describe the change"
```
