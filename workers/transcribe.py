"""Version 1 JSON-lines protocol. Local files/models only; CPU int8, no downloads."""
import json
import os
import sys
from pathlib import Path


def emit(value):
    print(json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)


def model_root():
    value = os.environ.get("MOTIONCRAFT_WHISPER_MODELS", "")
    return Path(value).resolve() if value else None


def available_models():
    root = model_root()
    if not root or not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir() and not p.is_symlink()
                  and (p / "model.bin").is_file() and (p / "config.json").is_file()
                  and (p / "tokenizer.json").is_file())[:1000]


def main():
    request = json.loads(sys.stdin.readline(1024 * 1024))
    if request.get("version") != 1 or request.get("action") not in ("detect", "transcribe"):
        raise ValueError("Unsupported worker request")
    try:
        import faster_whisper
    except ImportError:
        emit({"version": 1, "type": "runtime", "available": False, "models": [],
              "message": "Install faster-whisper in the configured Python environment."})
        return
    models = available_models()
    if request["action"] == "detect":
        emit({"version": 1, "type": "runtime", "available": True, "models": models,
              "message": "CPU int8. Local models only; no automatic downloads."})
        return
    name = request["model"]
    if name not in models:
        raise ValueError("Selected transcription model is not installed locally")
    root = model_root()
    model_path = (root / name).resolve()
    if not model_path.is_relative_to(root):
        raise ValueError("Invalid model location")
    model = faster_whisper.WhisperModel(str(model_path), device="cpu", compute_type="int8",
                                       local_files_only=True, cpu_threads=max(1, min(4, os.cpu_count() or 1)))
    # PyAV (a faster-whisper dependency) decodes MP3/WAV locally without PATH FFmpeg.
    segments, info = model.transcribe(request["audio"], language=request.get("language"),
                                      word_timestamps=True, beam_size=3)
    result = []
    for segment in segments:
        text = segment.text.strip()
        if not text or segment.end <= segment.start:
            continue
        item = {"start": segment.start, "end": segment.end, "text": text}
        words = [{"text": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                 for w in (segment.words or []) if w.end > w.start]
        if words:
            item["words"] = words
        result.append(item)
        if len(result) > 10000:
            raise ValueError("Transcript exceeds the segment limit")
        emit({"version": 1, "type": "progress", "progress": min(1, segment.end / max(.001, info.duration))})
    emit({"version": 1, "type": "transcript", "language": info.language,
          "duration": info.duration, "segments": result})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never expose native paths, transcripts or model internals in UI errors.
        emit({"version": 1, "type": "error", "message": "Local transcription failed. Check the audio, model files and Python environment."})
        sys.exit(1)
