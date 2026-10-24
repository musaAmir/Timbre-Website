Real recorded keyboard demo audio for Timbre

CherryMX Brown and CherryMX Blue (PBT keycaps), and NK Cream (original recording by Ryan),
from hainguyents13/mechvibes at revision 326252a13e7bef4f1c35d08ef0189b5af6f8ba02.
Distributed under the upstream MIT license; see MECHVIBES-LICENSE.txt.
No pack-specific license override was present at the pinned revision.
Original key assignments are preserved, including source recordings shared by multiple keys.
These are complete keystroke recordings, not separate press/release samples.
No affiliation with Mechvibes or switch manufacturers is implied.

PROVENANCE.json records input/output hashes and processing.
Reproduce with: python3 scripts/export-demo-audio.py --app-source /path/to/Timbre
Requires Python 3 and ffmpeg; no additional Python packages.

manifest.json: profiles[profile].file is relative to this directory.
profiles[profile].keys[KeyboardEvent.code] contains offset and duration in seconds.
Load/decode the WAV once, then AudioBufferSourceNode.start(when, offset, duration).
Only keys present in the source config are included; do not invent per-key recordings.
