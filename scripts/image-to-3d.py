#!/usr/bin/env python3
"""单图生 3D（方案 A 的轻量实现）：把带透明通道的立绘做成"有厚度的立体纸片"。

做法：
  1. alpha 当剪影；
  2. 到剪影边缘的距离场 → 厚度（中心最厚、边缘为 0，像枕头/浮雕）；
  3. 前面用原图贴图，背面镜像贴图，边缘一圈侧壁；
  4. 导出 OBJ + MTL + 贴图，交给 render-turntable 渲染转台帧。

用法：image-to-3d.py <输入png> <输出.obj> [--grid 140] [--depth 0.35]
"""
import argparse, os
import numpy as np
from PIL import Image
from scipy import ndimage


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--grid', type=int, default=140, help='网格最长边')
    parser.add_argument('--depth', type=float, default=0.35, help='最大厚度（相对宽度）')
    parser.add_argument('--alpha-threshold', type=float, default=0.5)
    args = parser.parse_args()

    image = Image.open(args.input).convert('RGBA')
    alpha = np.asarray(image)[..., 3].astype(np.float32) / 255.0
    if alpha.max() < 0.1:
        raise SystemExit('输入图没有透明通道内容')

    # 裁到包围盒，保持长宽比
    ys, xs = np.where(alpha > args.alpha_threshold)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    crop = image.crop((x0, y0, x1 + 1, y1 + 1))
    w, h = crop.size
    scale = args.grid / max(w, h)
    W, H = max(8, int(w * scale)), max(8, int(h * scale))
    crop = crop.resize((W, H), Image.LANCZOS)
    mask = np.asarray(crop)[..., 3].astype(np.float32) / 255.0

    # 距离场 → 厚度
    inside = mask > args.alpha_threshold
    dist = ndimage.distance_transform_edt(inside)
    dist = dist / max(1e-6, dist.max())
    z = (dist ** 0.7) * args.depth * (W / max(W, H))

    texture_path = os.path.splitext(args.output)[0] + '.png'
    crop.save(texture_path)

    uv = lambda i, j: (i / (W - 1), 1 - j / (H - 1))
    verts, uvs, faces, face_uvs = [], [], [], []
    # 只为"剪影内"的格点建顶点，并把它们的编号记下来（否则 UV 会错位）
    vmap = [dict(), dict()]
    for layer in (0, 1):
        for j in range(H):
            for i in range(W):
                if not inside[j, i]:
                    continue
                zz = z[j, i] if layer == 0 else -z[j, i] * 0.35 - 0.02
                vmap[layer][(i, j)] = len(verts)
                verts.append(((i - W / 2) / W, (H / 2 - j) / W, zz))
                uvs.append(uv(i, j))

    def quad(i, j, layer):
        if i + 1 >= W or j + 1 >= H:
            return
        a = vmap[layer].get((i, j)); b = vmap[layer].get((i + 1, j))
        c = vmap[layer].get((i, j + 1)); d = vmap[layer].get((i + 1, j + 1))
        if None in (a, b, c, d):
            return
        faces.extend([(a, b, c), (b, d, c)])
        face_uvs.extend([(a, b, c), (b, d, c)])

    for layer in (0, 1):
        for j in range(H - 1):
            for i in range(W - 1):
                quad(i, j, layer)

    # 侧壁：剪影边界像素，把前后两层连起来
    for j in range(H - 1):
        for i in range(W - 1):
            if not inside[j, i]:
                continue
            neighbours = [(i + 1, j), (i, j + 1)]
            for (ni, nj) in neighbours:
                if ni >= W or nj >= H or inside[nj, ni]:
                    continue
                front_a = vmap[0].get((i, j)); front_b = vmap[0].get((ni, nj))
                back_a = vmap[1].get((i, j)); back_b = vmap[1].get((ni, nj))
                if None in (front_a, front_b, back_a, back_b):
                    continue
                faces.extend([(front_a, back_a, front_b), (front_b, back_a, back_b)])
                face_uvs.extend([(front_a, back_a, front_b), (front_b, back_a, back_b)])

    with open(args.output, 'w') as f:
        f.write('# image-to-3d\n')
        for v, t in zip(verts, uvs):
            f.write('v %.5f %.5f %.5f\n' % v)
        for t in uvs:
            f.write('vt %.5f %.5f\n' % t)
        f.write('usemtl material0\n')
        for face in face_uvs:
            f.write('f %d/%d %d/%d %d/%d\n' % (face[0] + 1, face[0] + 1, face[1] + 1, face[1] + 1, face[2] + 1, face[2] + 1))

    with open(os.path.splitext(args.output)[0] + '.mtl', 'w') as f:
        f.write('newmtl material0\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\nd 1\nillum 1\nmap_Kd %s\n' % os.path.basename(texture_path))

    print(f'{{"ok": true, "obj": "{args.output}", "grid": "{W}x{H}", "verts": {len(verts)}, "faces": {len(faces)}}}')


if __name__ == '__main__':
    main()
