"""在「单词听力」语料上微调 GPT-SoVITS v2（英文单说话人）。

分三步，都可以单独重跑：

    prepare    2-name2text / 4-cnhubert / 5-wav32k / 6-name2semantic
    s2         训练 SoVITS（音色 + 声码器）
    s1         训练 GPT（韵律/语义，可选但效果更好）

ML 这边是 CPU 训练（GPT-SoVITS 还没适配 MPS），所以默认参数按「能跑完」来：
batch 小、epoch 少，先拿到能听的结果。

用法：
    python train_gsv.py prepare --dataset ~/Documents/大肥鱼声音/dataset-ocr2 --name teacher
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import common  # noqa: E402

GSV_ROOT = os.environ.get("GSV_ROOT", os.path.expanduser("~/Downloads/dfy/gpt-sovits"))
PRETRAINED = os.path.join(GSV_ROOT, "GPT_SoVITS", "pretrained_models")
S1_CKPT = os.path.join(PRETRAINED, "gsv-v2final-pretrained", "s1bert25hz-5kh-longer-epoch=12-step-369668.ckpt")
S2_G = os.path.join(PRETRAINED, "gsv-v2final-pretrained", "s2G2333k.pth")
S2_D = os.path.join(PRETRAINED, "gsv-v2final-pretrained", "s2D2333k.pth")
BERT = os.path.join(PRETRAINED, "chinese-roberta-wwm-ext-large")
HUBERT = os.path.join(PRETRAINED, "chinese-hubert-base")


def exp_dir(name):
    return os.path.join(GSV_ROOT, "logs", name)


def build_list(dataset, out_dir, name, speaker="teacher"):
    """manifest.jsonl → GPT-SoVITS 的 xxx.list（路径|说话人|语言|文本）。"""
    manifest = os.path.join(os.path.expanduser(dataset), "manifest.jsonl")
    if not os.path.isfile(manifest):
        raise SystemExit(f"找不到 {manifest}")
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    seen = set()
    with open(manifest, encoding="utf-8") as handle:
        for line in handle:
            try:
                item = json.loads(line)
            except Exception:
                continue
            audio = os.path.join(os.path.expanduser(dataset), item["audio"])
            text = str(item.get("text", "")).strip()
            if not os.path.isfile(audio) or not text:
                continue
            key = os.path.basename(audio)
            if key in seen:
                continue
            seen.add(key)
            rows.append(f"{audio}|{speaker}|en|{text}")
    list_path = os.path.join(out_dir, f"{name}.list")
    with open(list_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(rows) + "\n")
    seconds = 0.0
    for row in rows:
        try:
            import soundfile as sf

            info = sf.info(row.split("|")[0])
            seconds += info.frames / info.samplerate
        except Exception:
            pass
    hours = seconds / 3600
    print(json.dumps({"list": list_path, "clips": len(rows), "hours": round(hours, 2)}, ensure_ascii=False))
    return list_path


def base_env():
    """子进程公共环境：ffmpeg 进 PATH，仓库根 + GPT_SoVITS 进 PYTHONPATH。"""
    full = dict(os.environ)
    ffmpeg = common.find_ffmpeg()
    if ffmpeg and os.path.isfile(ffmpeg):
        full["PATH"] = os.path.dirname(ffmpeg) + os.pathsep + full.get("PATH", "")
    parts = [GSV_ROOT, os.path.join(GSV_ROOT, "GPT_SoVITS")]
    if full.get("PYTHONPATH"):
        parts.append(full["PYTHONPATH"])
    full["PYTHONPATH"] = os.pathsep.join(parts)
    return full


def run_stage(script, env, name):
    full = dict(os.environ)
    full.update({key: str(value) for key, value in env.items()})
    # prepare_datasets 里的脚本按「仓库根目录」运行，但 text/ 包在 GPT_SoVITS 下
    full = base_env()
    print(f"→ {script}", flush=True)
    proc = subprocess.run([sys.executable, "-s", script], cwd=GSV_ROOT, env=full)
    if proc.returncode != 0:
        raise SystemExit(f"{name} 失败（退出码 {proc.returncode}）")


def cmd_prepare(args):
    name = args.name
    out = exp_dir(name)
    os.makedirs(out, exist_ok=True)
    list_path = args.list or build_list(args.dataset, out, name)

    stage_env = {
        "inp_text": list_path,
        "inp_wav_dir": os.path.join(os.path.expanduser(args.dataset), "clips"),
        "exp_name": name,
        "opt_dir": out,
        "i_part": "0",
        "all_parts": "1",
        "is_half": "False",
        "_CUDA_VISIBLE_DEVICES": "0",
    }

    run_stage(os.path.join("GPT_SoVITS", "prepare_datasets", "1-get-text.py"),
              {**stage_env, "bert_pretrained_dir": BERT}, "1-get-text")
    # 单进程时脚本写出的是 2-name2text-0.txt，训练读的是 2-name2text.txt
    part = os.path.join(out, "2-name2text-0.txt")
    if os.path.isfile(part):
        shutil.copyfile(part, os.path.join(out, "2-name2text.txt"))

    run_stage(os.path.join("GPT_SoVITS", "prepare_datasets", "2-get-hubert-wav32k.py"),
              {**stage_env, "cnhubert_base_dir": HUBERT}, "2-get-hubert")

    run_stage(os.path.join("GPT_SoVITS", "prepare_datasets", "3-get-semantic.py"),
              {**stage_env, "pretrained_s2G": S2_G, "s2config_path": "GPT_SoVITS/configs/s2.json",
               "version": "v2"}, "3-get-semantic")
    print(json.dumps({"ok": True, "exp": out}, ensure_ascii=False))


def s2_config(name, args):
    path = os.path.join(GSV_ROOT, "GPT_SoVITS", "configs", "s2.json")
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    out = exp_dir(name)
    data["train"]["batch_size"] = args.batch
    data["train"]["epochs"] = args.epochs
    data["train"]["fp16_run"] = False
    data["train"]["text_low_lr_rate"] = 0.4
    data["train"]["pretrained_s2G"] = S2_G
    data["train"]["pretrained_s2D"] = S2_D
    data["train"]["if_save_latest"] = True
    data["train"]["if_save_every_weights"] = True
    data["train"]["save_every_epoch"] = args.save_every
    data["train"]["gpu_numbers"] = "0"
    data["train"]["grad_ckpt"] = False
    data["model"]["version"] = "v2"
    data["data"]["exp_dir"] = data["s2_ckpt_dir"] = out
    data["save_weight_dir"] = os.path.join(GSV_ROOT, "logs", f"{name}_weights")
    data["name"] = name
    data["version"] = "v2"
    os.makedirs(data["save_weight_dir"], exist_ok=True)
    tmp = os.path.join(out, "tmp_s2.json")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    return tmp


def cmd_s2(args):
    tmp = s2_config(args.name, args)
    print(f"→ s2_train.py --config {tmp}", flush=True)
    proc = subprocess.run([sys.executable, "-s", "GPT_SoVITS/s2_train.py", "--config", tmp], cwd=GSV_ROOT, env=base_env())
    raise SystemExit(proc.returncode)


def cmd_status(args):
    out = exp_dir(args.name)
    if not os.path.isdir(out):
        print(json.dumps({"ok": False, "error": "还没有这个实验"}, ensure_ascii=False))
        return
    info = {"exp": out}
    for part in ("2-name2text.txt", "6-name2semantic.tsv"):
        path = os.path.join(out, part)
        info[part] = os.path.getsize(path) if os.path.isfile(path) else 0
    for part in ("4-cnhubert", "5-wav32k"):
        path = os.path.join(out, part)
        info[part] = len(os.listdir(path)) if os.path.isdir(path) else 0
    weights = os.path.join(GSV_ROOT, "logs", f"{args.name}_weights")
    info["weights"] = sorted(os.listdir(weights)) if os.path.isdir(weights) else []
    print(json.dumps(info, ensure_ascii=False, indent=2))


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("prepare")
    p.add_argument("--dataset", default=os.path.join(common.VOICES, "dataset-ocr2"))
    p.add_argument("--name", default="teacher")
    p.add_argument("--list", default="")
    p.set_defaults(func=cmd_prepare)

    p = sub.add_parser("s2")
    p.add_argument("--name", default="teacher")
    p.add_argument("--batch", type=int, default=4)
    p.add_argument("--epochs", type=int, default=8)
    p.add_argument("--save-every", type=int, default=4)
    p.set_defaults(func=cmd_s2)

    p = sub.add_parser("status")
    p.add_argument("--name", default="teacher")
    p.set_defaults(func=cmd_status)

    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
