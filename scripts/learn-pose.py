#!/usr/bin/env python3
"""用 MediaPipe 骨骼点从视频里学姿势，映射成宠物动作。

- 自动挑选"动作最激烈的一段"（骨骼点平均速度最高的窗口）；
- intensity 参数控制幅度（0.3–3.0）；
- 输出新动作 clip 到 assets/pet/<name> 并加入 idleMicroClips。
"""
import json, math, os, sys, argparse, tempfile
from PIL import Image

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')
PET = os.path.join(ASSETS, 'pet')
MANIFEST = os.path.join(ASSETS, 'pet-manifest.json')
W, H = 412, 344
MODEL = os.path.expanduser('~/Downloads/dfy/models/pose_landmarker_lite.task')


def smooth(values, k=5):
    if not values:
        return values
    out = []
    for i in range(len(values)):
        lo = max(0, i - k // 2)
        hi = min(len(values), i + k // 2 + 1)
        out.append(sum(values[lo:hi]) / (hi - lo))
    return out


def normalize(values):
    lo, hi = min(values), max(values)
    if hi - lo < 1e-6:
        return [0.5] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def best_window(speeds, fps, seconds=2.5):
    span = max(2, int(seconds * fps))
    if len(speeds) <= span:
        return 0, len(speeds)
    scores = [sum(speeds[i:i + span]) / span for i in range(0, len(speeds) - span)]
    best = max(range(len(scores)), key=lambda i: scores[i])
    return best, best + span


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('video')
    parser.add_argument('name', nargs='?', default='pose')
    parser.add_argument('--intensity', type=float, default=1.0)
    parser.add_argument('--window', default='auto')
    parser.add_argument('--fps', type=float, default=10.0)
    args = parser.parse_args()

    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    capture = cv2.VideoCapture(args.video)
    fps = capture.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, int(round(fps / args.fps)))
    frames, index = [], 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % step == 0:
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        index += 1
    capture.release()

    landmarker = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MODEL),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        ))
    timeline = []
    for i, rgb in enumerate(frames):
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect_for_video(image, int(i * 1000 / args.fps))
        if result.pose_landmarks:
            points = result.pose_landmarks[0]
            timeline.append({k: (p.x, p.y) for k, p in enumerate(points)})
        else:
            timeline.append(None)
    landmarker.close()

    valid = [t for t in timeline if t]
    if len(valid) < 5:
        print(json.dumps({'ok': False, 'error': '没有检测到人体骨骼点'}, ensure_ascii=False))
        return

    speeds = []
    prev = None
    for t in timeline:
        if not t or not prev:
            speeds.append(0.0)
            prev = t
            continue
        speed = 0.0
        for i in (11, 12, 15, 16):  # 肩、腕
            if i in t and i in prev:
                speed += math.hypot(t[i][0] - prev[i][0], t[i][1] - prev[i][1])
        speeds.append(speed / 4)
        prev = t

    if args.window == 'auto':
        start, end = best_window(speeds, args.fps)
    else:
        start, end = 0, len(timeline)
    window = [t for t in timeline[start:end] if t]
    if not window:
        print(json.dumps({'ok': False, 'error': '窗口内没有骨骼点'}, ensure_ascii=False))
        return

    def series(point_index, axis):
        return normalize(smooth([t[point_index][axis] if point_index in t else 0.5 for t in window], 7))

    shoulder_angle = []
    for t in window:
        if 11 in t and 12 in t:
            dy = t[12][1] - t[11][1]
            dx = t[12][0] - t[11][0]
            shoulder_angle.append(normalize([math.degrees(math.atan2(dy, dx))])[0])
        else:
            shoulder_angle.append(0.5)
    shoulder_angle = normalize(smooth(shoulder_angle, 5))
    hip_y = series(23, 1)
    head_x = series(0, 0)
    wrist_y = series(16, 1)

    base_dir = os.path.join(PET, 'idle')
    base = [Image.open(os.path.join(base_dir, f)).convert('RGBA')
            for f in sorted(os.listdir(base_dir)) if f.endswith('.webp')]

    out_frames = 48
    out = []
    n = len(window)
    for i in range(out_frames):
        k = int(i / out_frames * (n - 1))
        lean = (shoulder_angle[k] - 0.5) * 2
        bob = (0.5 - hip_y[k]) * 2
        head = (head_x[k] - 0.5) * 2
        arm = (0.5 - wrist_y[k]) * 2
        angle = lean * 7.0 * args.intensity + head * 3.0 * args.intensity
        dx = head * 8.0 * args.intensity
        dy = bob * 7.0 * args.intensity - arm * 4.0 * args.intensity
        scale = 1.0 + arm * 0.03 * args.intensity
        img = base[i % len(base)].rotate(angle, resample=Image.BICUBIC, center=(W / 2, H * 0.9))
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        if scale != 1.0:
            w, h = int(W * scale), int(H * scale)
            img = img.resize((w, h), Image.LANCZOS)
            canvas.alpha_composite(img, ((W - w) // 2, H - h))
        else:
            canvas.alpha_composite(img, (0, 0))
        shifted = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        shifted.alpha_composite(canvas, (int(dx), int(dy)))
        out.append(shifted)

    out_dir = os.path.join(PET, args.name)
    os.makedirs(out_dir, exist_ok=True)
    for i, image in enumerate(out, 1):
        image.save(os.path.join(out_dir, f'{args.name}_{i:03d}.webp'), 'WEBP', quality=92, method=6)

    manifest = json.load(open(MANIFEST))
    manifest['clips'][args.name] = {
        'frames': [f'{args.name}/{args.name}_{i:03d}.webp' for i in range(1, len(out) + 1)],
        'frameMs': 70,
        'loop': True,
        'source': 'learned:pose',
    }
    micros = manifest.get('idleMicroClips') or []
    if args.name not in micros:
        micros.append(args.name)
    manifest['idleMicroClips'] = micros
    json.dump(manifest, open(MANIFEST, 'w'), ensure_ascii=False, indent=2)
    print(json.dumps({'ok': True, 'clip': args.name, 'frames': len(out), 'window': [start, end],
                      'samples': n, 'intensity': args.intensity}, ensure_ascii=False))


if __name__ == '__main__':
    main()
