#!/usr/bin/env python3
"""Export browser sprites from Timbre's pinned, MIT-licensed Mechvibes packs.

Requires Python 3 and ffmpeg. Default source is the sibling Timbre repository.
Run: python3 scripts/export-demo-audio.py [--app-source /path/to/Timbre]
"""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
RATE = 32000
PACKS = {"cream": "nk-cream", "brown": "cherrymx-brown-pbt", "blue": "cherrymx-blue-pbt"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def decode(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(RATE),
        "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1",
    ])
    frames = array.array("f", raw)
    if sys.byteorder != "little":
        frames.byteswap()
    assert frames and all(math.isfinite(x) for x in frames)
    return frames


def prepare(frames):
    # Remove near-silent lead/tail only, retaining 2 ms lead and 12 ms tail.
    threshold = max(abs(x) for x in frames) * .001
    audible = [i for i, x in enumerate(frames) if abs(x) > threshold]
    assert audible
    frames = frames[max(0, audible[0] - 64):min(len(frames), audible[-1] + 385)]
    # Tiny boundary fades avoid sprite-edge discontinuities without changing pitch.
    for i in range(min(16, len(frames))):
        frames[i] *= i / 16
    for i in range(min(96, len(frames))):
        frames[-1-i] *= i / 96
    return frames


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-source", type=Path, default=ROOT.parent / "Timbre")
    args = parser.parse_args()
    resources = args.app_source / "Sources/TimbreAudio/Resources"
    sources = json.loads((resources / "SoundPackSources.json").read_text())
    mapping_source = (args.app_source / "Sources/TimbreAudio/PhysicalKeyMap.swift").read_text()
    mappings = {
        name: re.findall(r'"([^\"]+)"', legacy)
        for name, legacy in re.findall(r'name: "([^\"]+)", legacy: \[([^\]]*)\]', mapping_source)
    }
    assert mappings["KeyA"] == ["30"] and mappings["Space"] == ["57"]
    dest = ROOT / "dist/assets/audio"
    dest.mkdir(parents=True, exist_ok=True)
    manifest = {"sampleRate": RATE, "profiles": {}}
    provenance = {
        "repository": sources["repository"], "revision": sources["commit"], "license": "MIT",
        "processing": "Original mappings; mono downmix and resample to 32000 Hz; near-silence trimming with 2 ms lead/12 ms tail retained; 0.5 ms attack/3 ms tail boundary fades; one gain per pack preserving relative key loudness; 10 ms gaps; PCM16. No pitch shift or synthesis.",
        "mappingSHA256": sha(mapping_source.encode()), "profiles": {},
    }
    for profile, folder in PACKS.items():
        source = next(x for x in sources["packs"] if x["directory"] == folder)
        path = resources / "SoundPacks" / folder
        for filename, expected in source["sha256"].items():
            assert sha((path / filename).read_bytes()) == expected, f"Changed source: {folder}/{filename}"
        config = json.loads((path / "config.json").read_text())
        sprite = decode(path / config["sound"]) if config["key_define_type"] == "single" else None
        chunks, key_chunks = {}, {}
        for code, legacy in mappings.items():
            definition = next((config["defines"].get(x) for x in legacy if config["defines"].get(x) is not None), None)
            if definition is None:
                continue
            identifier = json.dumps(definition)
            key_chunks[code] = identifier
            if identifier not in chunks:
                if isinstance(definition, str):
                    frames = decode(path / definition)
                else:
                    start, duration = definition
                    frames = sprite[round(start * RATE / 1000):round((start + duration) * RATE / 1000)]
                chunks[identifier] = prepare(frames)
        peaks = [max(abs(x) for x in frames) for frames in chunks.values()]
        gain = min(.5 / statistics.median(peaks), .94 / max(peaks))
        samples = array.array("h")
        offsets = {}
        for identifier, frames in chunks.items():
            offsets[identifier] = {"offset": len(samples) / RATE, "duration": len(frames) / RATE}
            samples.extend(round(x * gain * 32767) for x in frames)
            samples.extend([0] * 320)
        if sys.byteorder != "little":
            samples.byteswap()
        output = dest / f"{profile}.wav"
        with wave.open(str(output), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(RATE)
            audio.writeframes(samples.tobytes())
        keys = {code: offsets[identifier] for code, identifier in key_chunks.items()}
        manifest["profiles"][profile] = {"file": output.name, "keys": keys}
        provenance["profiles"][profile] = {
            "name": config["name"], "source": source["source"],
            "originalSHA256": source["sha256"], "outputSHA256": sha(output.read_bytes()),
            "gain": gain, "distinctRecordings": len(chunks), "mappedKeys": len(keys),
        }
        with wave.open(str(output), "rb") as check:
            assert check.getframerate() == RATE and check.getnchannels() == 1 and check.getsampwidth() == 2
            rendered = []
            for code in ("KeyA", "Space", "Enter", "Backspace"):
                item = keys[code]
                check.setpos(round(item["offset"] * RATE))
                rendered.append(check.readframes(round(item["duration"] * RATE)))
            assert len({sha(x) for x in rendered}) == 4, f"Missing distinct important keys in {profile}"
            assert all(v["offset"] + v["duration"] <= check.getnframes() / RATE for v in keys.values())
        print(f"{profile}: {len(keys)} mapped keys, {len(chunks)} recordings, {output.stat().st_size:,} bytes")
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (dest / "PROVENANCE.json").write_text(json.dumps(provenance, indent=2) + "\n")
    (dest / "MECHVIBES-LICENSE.txt").write_bytes((resources / "MECHVIBES-LICENSE.txt").read_bytes())
    (dest / "README.txt").write_text(
        "Real recorded keyboard demo audio for Timbre\n\n"
        "CherryMX Brown and CherryMX Blue (PBT keycaps), and NK Cream (original recording by Ryan),\n"
        "from hainguyents13/mechvibes at revision " + sources["commit"] + ".\n"
        "Distributed under the upstream MIT license; see MECHVIBES-LICENSE.txt.\n"
        "No pack-specific license override was present at the pinned revision.\n"
        "Original key assignments are preserved, including source recordings shared by multiple keys.\n"
        "These are complete keystroke recordings, not separate press/release samples.\n"
        "No affiliation with Mechvibes or switch manufacturers is implied.\n\n"
        "PROVENANCE.json records input/output hashes and processing.\n"
        "Reproduce with: python3 scripts/export-demo-audio.py --app-source /path/to/Timbre\n"
        "Requires Python 3 and ffmpeg; no additional Python packages.\n\n"
        "manifest.json: profiles[profile].file is relative to this directory.\n"
        "profiles[profile].keys[KeyboardEvent.code] contains offset and duration in seconds.\n"
        "Load/decode the WAV once, then AudioBufferSourceNode.start(when, offset, duration).\n"
        "Only keys present in the source config are included; do not invent per-key recordings.\n"
    )


if __name__ == "__main__":
    main()
