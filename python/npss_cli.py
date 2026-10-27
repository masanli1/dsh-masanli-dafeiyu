#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NPSS-Enhancer CLI, wrapped for the dsh-npss-denoiser DSH plugin.

Reads a WAV file (the plugin converts other containers to WAV first), runs the
training-free NPSS pipeline, writes a stereo 16-bit WAV and prints one line of
JSON on stdout so the caller does not have to parse free-form logs.

License: academic / non-commercial free (see LICENSE-ACADEMIC.md); commercial
use requires a paid license (LICENSE-COMMERCIAL.md).
SPDX-License-Identifier: LicenseRef-NPSS-Academic-1.0
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common as C  # noqa: E402
import engine  # noqa: E402


def denoise_channel(channel, sr, args, info):
    return engine.denoise_array(
        channel,
        sr,
        content_mode=args.mode,
        complement=True,
        loops=max(2, min(8, args.loops)),
        multi_stat=True,
        fast=args.fast,
        workers=args.workers,
        chunk_sec=args.chunk,
        target_nr_db=args.target_nr,
        info_out=info,
        view_profile=args.view_profile,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Training-free NPSS denoiser")
    parser.add_argument("input", help="input WAV file")
    parser.add_argument("output", help="output WAV file")
    parser.add_argument("--mode", choices=["music", "voice"], default="music")
    parser.add_argument("--target-nr", type=float, default=None, metavar="DB",
                        help="push the noise floor to exactly DB below (定果寻因)")
    parser.add_argument("--fast", action="store_true", help="fast mode (K=6, 2 passes)")
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--loops", type=int, default=5)
    parser.add_argument("--chunk", type=float, default=20.0)
    parser.add_argument("--view-profile", default="freq",
                        choices=["freq", "energy", "struct", "off"])
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(json.dumps({"error": "input not found: %s" % args.input}, ensure_ascii=False))
        return 2

    started = time.time()
    x, sr = C.read_wav_stereo(args.input)
    x = np.asarray(x, dtype=np.float32)
    if x.ndim == 1:
        x = x[:, None]

    info = {}
    if x.shape[1] == 1 or np.allclose(x[:, 0], x[:, 1]):
        mono = denoise_channel(x[:, 0], sr, args, info)
        y = np.repeat(mono[:, None], 2, axis=1)
    else:
        channels = [denoise_channel(x[:, ci], sr, args, info) for ci in range(2)]
        length = min(len(channels[0]), len(channels[1]))
        y = np.stack([channels[0][:length], channels[1][:length]], axis=1)

    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak > 1.0:
        y = y / peak
    C.write_wav_stereo(args.output, y, sr)

    elapsed = time.time() - started
    seconds = len(x) / float(sr) if sr else 0.0
    result = {
        "input": os.path.abspath(args.input),
        "output": os.path.abspath(args.output),
        "mode": args.mode,
        "viewProfile": args.view_profile,
        "sampleRate": int(sr),
        "channels": int(x.shape[1]),
        "durationSeconds": round(seconds, 3),
        "seconds": round(elapsed, 2),
        "rtf": round(elapsed / max(1e-9, seconds), 3),
    }
    if "achieved_db" in info:
        result.update({
            "targetDb": args.target_nr,
            "achievedDb": round(float(info["achieved_db"]), 2),
            "hit": bool(info.get("hit")),
        })
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
