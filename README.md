# Structural Stress Analyzer Project

**Resume here:** [November 18 handoff and latest hardware findings](docs/HANDOFF-2026-11-18.md).

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

Supported imports (up to 10 MB and 100,000 readings per test):

- CSV with `displacement_in` and `force_lb` headers. Optional `time_s`, packet references and raw numeric fields are retained. The original evidence CSV's `first_time_relative_s` is recognized.
- Raw ASCII records in the observed `dddd,ffff\r` format. Exact bytes are retained. An incomplete final record is rejected without replacing the current recording.
- Complete workspace `*.session.json` archives (schema version 1).
- Python investigator `*.jsonl` logs containing RX measurement records. Original log text and raw RX/TX-result bytes are retained, including unfinished tails. Logs without measurement records remain evidence files rather than graphable recordings.

Imported data without timestamps use a clearly labeled paced replay; synthetic pacing is never written into the measurement timestamps. Raw-evidence-only JSON is an evidence export, not a complete reopenable session.

All graph units are **inches and pounds**. Import does not perform unit conversion. The data are force/displacement, not specimen stress/strain. No calibration or material-property calculation is claimed.

## Live instrument use (experimental)

Use the hosted HTTPS page in desktop Chrome or Edge. Close SSA and disconnect Python first. Choose **Connection** and select the Prolific adapter directly in the browser USB port picker. There is no preliminary options dialog. Set SAE units on the instrument before connecting and export recordings you need to keep. Opening/closing the port can affect control signals and machine state. The user must be beside a clear tester with physical power control available.

Connection uses 9600 8N1, no flow control, with DTR and RTS on. It sends **zero startup commands**. No automatic homing, Start, reconnect, or retry occurs. Live mode hides the historical graph until actual live measurements arrive. Incoming `dddd,ffff` records are interpreted as inches/pounds assuming the operator has selected SAE units on the instrument. Timestamps are browser arrival times. Keep the instrument in SAE throughout the connection.

- **Read version** sends bare `V`; observed reply `V4.0\r` is consistent with a version query.
- **Home** sends bare `H` on one operator button click.
- **Start Test** sends bare `T` on one operator button click. Multiple tests share one connection. Start becomes available after TT or a completed TU/H return; a maximum-force TM event requires an explicit Home and its reply first. Duplicate or overlapping starts remain blocked. Each Start clears the graph for the new test; previous measurements and test boundaries remain in the complete exact-byte log. CSV/chart exports show the current test, while complete-session JSON includes its measurements plus exact raw bytes/logs for all tests in this connection. The user explicitly authorized implementing T on November 18. No browser test has been started on hardware during implementation.
- **Stop request** sends bare `S`. An idle `S\r` reply and operator-observed active stop/return sequences have been recorded, including the armed 100 lb trial. Stopping performance and peak force after the request are not independently verified. A request or reply must never be presented as proof that the machine stopped.
- **Select Continuous** sends bare `C`. **Set Incremental · 10 lb** sends `I`, waits for `I\r`, waits 400 ms as in the captured exchange, then sends exactly `MI010\r`. No Start is sent during setup. There is no verified parameter acknowledgment, so the page labels it requested. Other increments, Cyclic, jog, calibration and guessed parameters remain unavailable.
- **Continue increment** sends one confirmed `T` for the existing Incremental test, preserving all measurements and the software-stop monitor. It requires a new nonzero reading following the expected D/ID reply. Click Continue only when the mechanism has physically paused; no confirmation popup is shown. ID alone does not establish a pause. No automatic resumes or retries occur.
- **Maximum-force research:** [saved-evidence review](docs/maximum-force-investigation.txt) supports a possible PC-side software stop threshold; no numeric hardware-setting command is established. The explicitly armed experimental software threshold below implements a one-shot S request, not a hardware setting.
- **Test Config remains a local draft.** Global maximum force, incremental force, cyclic force and cycle count are not applied or enforced by this page. Start uses the instrument's current settings. The separate live Incremental button requests only the captured 10 lb setting; Test Config remains unrelated to that request.

Live data and exact RX/TX-attempt/result events are retained in browser recovery. **Download live log** preserves a JSONL file even if no measurements arrive; check the browser download completed. Recovery is not a durable disk-write guarantee. A logging failure or a read/write error closes the connection without retry; physical motion may continue. Closing or reloading does not display a confirmation dialog. Download recordings regularly; closing the page does not establish stopped motion.

### Experimental software stop threshold

Before **each test**, while idle after connecting or after the previous test/return has completed, choose a whole-pound **Software stop threshold** from 10 to 1000 lb, click **Arm threshold** before Start. Arming sends no bytes. The page will send one bare `S` when the first complete received force reading reaches or exceeds that value during its requested test. The threshold status shows whether it is armed. This field is separate from Test Config's local draft; changing that draft does not change an armed threshold.

The armed value locks until disarmed before Start. During a test or return it cannot be edited/disarmed. After completion you can arm a new threshold for the next test without reconnecting. A used threshold is never automatically rearmed. New connections and reloaded/recovered pages never restore arming automatically. Unexpected measurements before Start cancel arming; verify the tester is idle before arming again. Manual Stop supersedes the threshold to avoid an automatic duplicate. If a crossing arrives during an in-flight write, one Stop is queued until the writer releases; a terminal marker received first cancels that queued write. An uncertain/failed Stop is never retried automatically. There is no automatic Home or restart.

The threshold, crossing reading, TX reason, host-write result and later device markers are saved in the exact log. Session exports/recovery retain the threshold and outcome in their source description. The original measurements and raw bytes remain unchanged, including values received after the trigger. A completed S write is not proof that force stopped or the mechanism is unloaded.

**This is experimental software assistance, not a safety-rated interlock, device force-setting command, or guaranteed maximum force.** It depends on live telemetry, an executing browser tab, working storage/logging and a successful device response. Force can overshoot. Read/logging/connection failure ends monitoring and may leave motion continuing. Keep the guard closed and physical power accessible. Automatic threshold operation has passed saved-stream/fake-port tests; one real armed 100 lb run transmitted 47, 70, 94 and 118 lb, automatically sent one S at 118, and received TU then H. The actual peak and mechanical stopping time remain unknown; see evidence/2026-11-18/first-observed-100lb-software-stop-findings.txt.

Offline 60 lb threshold replay first qualified at 70 lb in the saved aluminum run and 64 lb in the wood run. Those values identify when software could request Stop; they do not predict the final stopped force. No real machine commands were sent during implementation/testing.

### Maximum-force event (`TM`)

The wood trial recorded `TM\r` immediately after 37 measurements, alongside the operator's report that the tester displayed maximum force exceeded. The last transmitted reading was **994 lb at 0.035 in**; that is not proof of the exact trip force or configured threshold. `TT\r` remains the distinct normal test-end marker.

Receiving a complete `TM\r` now records a force-limit result, shows a persistent warning with the last transmitted reading, and releases the pending-test guard so **Home can be explicitly requested with its motion confirmation**. No Home, Stop, retry or reconnect is sent automatically. Start stays blocked until a Home reply completes the explicit return; it can then begin another test on the same connection. The warning survives later S/version replies and disconnect; the result is retained in the JSONL log and exported/recovered session description. Neither TM nor a later S reply proves the specimen is unloaded or motion has stopped. This change does not implement or validate the lower force cutoff.

When disconnected, choose **Review recording** to use replay/import controls again. Complete-session, CSV, raw evidence and chart exports work with received measurements; the complete live log retains nonmeasurement replies and unfinished byte tails. A recovered log can be downloaded on the next visit without opening hardware. New connections open the device picker directly; use the same SAE settings and physical readiness each time. A new browser profile/device does not share recovery.

The live recorder limits a connection to 2 MB of raw incoming bytes, 100,000 readings per test and 4 KB of pending unterminated text. Browser storage may fill sooner; save sessions regularly. HTTP requests do not upload imported/live measurements; communication goes through the operator-selected local serial port.

### Observed stop/return sequence (`TU` then `H`)

In the saved brief Stop trial, the browser sent `T`, then `S`. The tester sent `TU\r`, followed by `H\r`, without a browser Home command. The operator observed motion stop and apparently return home. Only one zero-force measurement was recorded, so significant-load stopping, guaranteed latency and emergency-stop performance remain unverified. The full firmware meaning of TU is not documented; its classification follows this observed sequence.

The page now shows **Stop/return sequence recorded**, keeps Home and mode changes blocked while awaiting the separate Home reply, then records **Home reply received**. A plain `S\r` alone does not clear the pending-test guard. The page never sends Home automatically. A disconnect before H is shown as an unknown return outcome. Another Start is available after the Home reply without reconnecting; verify physical position and load before interacting with the fixture. Both the sequence and Home report survive log/session export and browser recovery. An earlier maximum-force warning is retained if both events occur in a connection.

See [the exact chronology and limitations](evidence/2026-11-18/active-stop-return-home-findings.txt).

## Verification

Data/model tests need Node.js:

```powershell
node --test tests/model.test.cjs tests/workspace.test.cjs tests/live.test.cjs tests/incremental.test.cjs
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

The [final webpage plan](docs/final-webpage-plan.txt) describes the intended live interface. The familiar layout and experimental Web Serial implementation are now present; browser connection and machine actions still require hardware validation with the operator present. Only the captured Incremental 10 lb live setup is exposed; other numeric live configuration remains unavailable. No hardware access is needed to continue work on offline features.

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

## Incremental workflow (experimental, captured 10 lb setup)

1. Save the previous recording and close original SSA/Python. With the covers and guard in place and the instrument ready, connect and read version. Connection sends no startup commands.
2. Click **Set Incremental · 10 lb**. The page waits for an exact I reply before sending MI010 with carriage return; no acknowledgment is invented for that parameter. Setup stops on missing mode reply, Stop, disconnect, or unexpected device activity. An incomplete setup blocks Start; reconnect before attempting it again. Selecting Continuous explicitly abandons that setup.
3. Optionally arm the separate overall software stop threshold before the first Start. It stays active across increments until triggered, cancelled, or the test ends. It is not the nominal increment size and does not impose an exact maximum.
4. Click **Start Test** once; it sends immediately. A zero reading does not enable Continue. After a nonzero reading associated with the step reply, physically verify the mechanism has paused. Click **Continue increment** once for each additional step; it sends immediately. The specimen can remain loaded during pauses; keep clear.
5. Stop remains available. S is a request, not proof of unloading. After a complete nonzero Incremental reading, Home is also available, including after an S echo, by clicking Home while the mechanism is physically paused. It sends H once and waits for a Home reply; this paused-state hardware behavior is not yet verified. Continue stays disabled after Stop. Wait for device end/return reports and verify the machine's actual state. Home is not automatically sent. A terminal TM requires explicit Home before a new test; a normal TU/H return unlocks a fresh Start. Do not resume a paused specimen using the new-test Start button.

The original SSA capture requested 10 lb but achieved 57,132,176,214,249,286,320 lb at .001,.003,.005,.006,.007,.008,.009 in. Actual step increases of 34–75 lb show this is not a precise 10 lb load controller or slower motor speed. Its first T returned D plus readings; later T requests returned ID then another reading. Identical MI010 bytes also preceded failed exchanges before operator reset, so the application/firmware instability is unresolved. The replacement never replays failed bursts or infers stopped motion from a reading alone.

The graph, CSV and structured session samples retain the whole current Incremental test across all resumes. Source descriptions include mode and number of step requests; raw logs retain setup, operator button clicks, step numbers, threshold outcomes and all connection bytes. Reload/recovery does not restore a hardware connection, Incremental readiness or automatic operation. The implementation is verified with captured data and simulated ports; no real instrument command is sent during implementation or automated tests.

### Incremental Home correction and real browser evidence

The second browser Incremental recording contains five step requests and forces66,145,189,226,264lb, then a manual S with only S CR in reply. No host H was sent: the previous active-test guard kept Home disabled during an Incremental pause. The operator reported a different retained LCD value and eventual physical-button Home; that physical sequence is not recorded in this exported session.

Home is now permitted after a complete positive-force step reading, including after Stop, with one operator click while physically paused. No movement is inferred from a numeric reading or S echo. One H request locks further Home/Start/Continue while awaiting the reply, with no timeout retry or automatic follow-up. An H reply completes the requested-return guard; it does not independently verify position or unloading. Plotted values remain the last test readings. Start/Continue stay blocked during active steps, incomplete readings and an already pending return. Existing TU/H automatic-return handling is preserved.

The earlier first browser Incremental run had an overall software threshold10lb armed as well as the nominal10lb step. At52lb the software sent S and received TU/H, ending that test. Step size and overall software stop are distinct. Those exact sessions and findings are preserved in evidence/2026-11-18. No live hardware Home command was sent during this correction or automated validation.

## One-click controls

At the operator's request, Start Test, Continue increment, Home and Stop request transmit on a single click. Arm threshold also takes one click; its extra consent checkbox and the movement confirmation dialog are removed. Closing/reloading has no application before-unload confirmation. Current action, threshold and device replies remain visible as status text. No commands are sent merely by opening/reloading/connecting the page, and thresholds are not automatically armed.

The existing protocol guards remain: one pending write, no duplicate pointer double-click command, no overlapping test/return, an Incremental reply plus nonzero reading before Continue, and a completed reading before paused-state Home. A button click is an operator request, not a measurement of physical pause or unloaded state. JSONL events use interaction=button-click and do not fabricate physical-pause confirmation. The lower-level module retains explicit authorization arguments for programmatic callers; the UI supplies them from the deliberate button click.

Earlier references to motion confirmation dialogs and consent checkboxes describe previous versions and are superseded by this section.
