# Structural Stress Analyzer Project

A local workspace and diagnostic tools for replacing the Structural Stress Analyzer 1000 software. The browser workspace currently operates **offline only**. No replacement software has connected to or commanded the tester.

## Open the workspace

Double-click **index.html** in Microsoft Edge or Chrome. Keep the project folder together. No server, installation, internet connection, or build step is needed for the webpage.

The familiar left column contains Settings, Test Config, Home, Start Test, Stop Test, Save Data, Disconnect, and Session details. **Home/Start/Stop/Disconnect are disabled**: the page has no serial API implementation or machine controls.

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

## Verification

Data/model tests need Node.js:

```powershell
node --test tests/model.test.cjs tests/workspace.test.cjs
node --check app.js
```

These compare the original data and exact serial bytes, preserve repeated positions and tail readings, test stream chunk boundaries, validate configuration, round-trip sessions/CSV, reject invalid files, and check chart ranges.

An optional end-to-end check uses Playwright and a fresh **headless** Edge profile:

```powershell
node tests/browser-check.cjs
```

Playwright must be available through normal module resolution or `NODE_PATH`; `SSA_BROWSER_PATH` can override the default Windows Edge executable. Browser checks cover dialogs, draft fields, recovery/reload, all graph/session exports, imports and malformed files, replay completion, storage/save failures, corrupted recovery preservation, and 1366/768/375/320 px layouts. They reject instrument API access and check for external HTTP requests. Screenshots and downloaded checks go under ignored `work/browser-check/`.

## Python command investigator

Double-click **launch-investigator.cmd** for the separate diagnostic window. Instructions: [docs/python-investigator.txt](docs/python-investigator.txt).

It starts disconnected, previews exact bytes, sends only an explicitly chosen message, blocks ASCII T in every input format, and logs TX attempts/results and RX chunks. There is no automatic startup command, alphabet sweep or retry after uncertain delivery. Its offline replay uses the real captured stream.

pySerial 3.5 is installed in the ignored project `.venv` environment. Nine hardware-free tests are available:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -p test_probe.py -v
```

Transient logs go under ignored `sessions/`. After an informative experiment, inspect, copy, hash and commit selected logs into a new evidence session. The Python console has not yet been tested against this instrument.

## Preserved evidence and current findings

See [evidence/2026-11-17](evidence/2026-11-17/) and [the next-session handoff](docs/next-session.txt).

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

The [final webpage plan](docs/final-webpage-plan.txt) describes the intended live interface. The familiar offline layout is now implemented; live connection/configuration and machine actions still require individual verification with the operator present. No hardware access is needed to continue work on offline features.

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
