// @ts-check
// Heavy decoding/analysis and PCM processing run only in the owned audio worker.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  { createHash, randomUUID } = require("node:crypto");
const { binary, probe } = require("../electron/render-binaries.cjs"),
  { analysisSchema, defaultAudio } = require("../core/audio/schema.cjs"),
  { clipGain, audibleTrack, dbToGain } = require("../core/audio/engine.cjs"),
  { createProcessor } = require("../core/audio/dsp.cjs");
const { createTimelineIndex } = require("../core/timeline/commands.cjs");
/** @type {Set<import("node:child_process").ChildProcess>} */
const children = new Set();
process.once("exit", () => {
  for (const c of children) c.kill();
});
/** @param {import("zod").infer<typeof import("../rendering/contracts.cjs").workerRequestSchema>["bindings"][number]} binding */
async function verify(binding) {
  const real = await fs.realpath(binding.originalPath),
    s = await fs.stat(real);
  if (
    real !== binding.originalPath ||
    !s.isFile() ||
    s.ino !== binding.ino ||
    s.size !== binding.size ||
    s.mtimeMs !== binding.modifiedAt
  )
    throw new Error("Media changed. Relink it before audio processing.");
}
/** @param {unknown} value */
const key = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** @param {number} samples */
function header(samples, channels = 2, rate = 48000, float = false) {
  const bytesPerSample = float ? 4 : 2;
  const b = Buffer.alloc(44),
    bytes = samples * channels * bytesPerSample;
  b.write("RIFF");
  b.writeUInt32LE(bytes + 36, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(float ? 3 : 1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * bytesPerSample, 28);
  b.writeUInt16LE(channels * bytesPerSample, 32);
  b.writeUInt16LE(float ? 32 : 16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
// Accept only a bounded PCM WAV header, then stream sample data without buffering the file.
/** @param {string[]} args @param {(data:Buffer)=>unknown|Promise<unknown>} onSamples */
async function decode(args, onSamples, float = false) {
  let prefix = Buffer.alloc(0),
    ready = false,
    remainder = Buffer.alloc(0),
    diagnostics = "";
  const child = spawn(
    binary("ffmpeg"),
    ["-v", "error", ...args, "-c:a", float ? "pcm_f32le" : "pcm_s16le", "-f", "wav", "pipe:1"],
    { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.add(child);
  const timer = setTimeout(() => child.kill(), 30 * 60 * 1000);
  child.stderr.on("data", (d) => {
    if (diagnostics.length < 4000) diagnostics += d.toString();
  });
  /** @type {Promise<void>} */
  const exit = new Promise((resolve, reject) => {
    child.once("error", () => reject(new Error("Local audio decoder could not start.")));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else {
        if (process.env.MOTIONCRAFT_AUDIO_DIAGNOSTICS === "1") console.error(diagnostics);
        reject(new Error("Audio decoding failed. Check source audio streams and codec support."));
      }
    });
  });
  exit.catch(() => {});
  try {
    for await (const raw of child.stdout) {
      let chunk = Buffer.from(raw);
      if (!ready) {
        prefix = Buffer.concat([prefix, chunk]);
        if (prefix.length < 12) continue;
        if (prefix.toString("ascii", 0, 4) !== "RIFF" || prefix.toString("ascii", 8, 12) !== "WAVE")
          throw new Error("Invalid PCM decoder header.");
        let offset = 12;
        while (offset + 8 <= prefix.length) {
          const length = prefix.readUInt32LE(offset + 4);
          if (prefix.toString("ascii", offset, offset + 4) === "data") {
            chunk = prefix.subarray(offset + 8);
            ready = true;
            break;
          }
          offset += 8 + length + (length % 2);
        }
        if (!ready) {
          if (prefix.length > 65536) throw new Error("PCM header exceeds limit.");
          continue;
        }
      }
      chunk = Buffer.concat([remainder, chunk]);
      const usable = chunk.length - (chunk.length % (float ? 4 : 2));
      await onSamples(chunk.subarray(0, usable));
      remainder = chunk.subarray(usable);
    }
    await exit;
    if (!ready) throw new Error("No decodable audio.");
  } finally {
    clearTimeout(timer);
    children.delete(child);
    if (child.exitCode === null) child.kill();
  }
}
/** @param {Parameters<typeof verify>[0]} binding @param {{start:number,end:number}|undefined} [range] @returns {Promise<{lufs:number|null,truePeakDb:number|null}>} */
async function loudness(binding, range) {
  await verify(binding);
  return new Promise((resolve, reject) => {
    let output = "";
    const c = spawn(
      binary("ffmpeg"),
      [
        "-v",
        "info",
        ...(range ? ["-ss", String(range.start)] : []),
        "-i",
        binding.originalPath,
        ...(range ? ["-t", String(range.end - range.start)] : []),
        "-vn",
        "-af",
        "loudnorm=I=-16:TP=-1:LRA=11:print_format=json",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, shell: false, stdio: ["ignore", "ignore", "pipe"] },
    );
    children.add(c);
    const timer = setTimeout(() => c.kill(), 30 * 60 * 1000);
    c.stderr.on("data", (d) => {
      output = (output + d.toString()).slice(-16000);
    });
    c.once("error", () => {
      clearTimeout(timer);
      children.delete(c);
      reject(new Error("Loudness analyzer unavailable."));
    });
    c.once("close", (code) => {
      clearTimeout(timer);
      children.delete(c);
      if (code !== 0) return resolve({ lufs: null, truePeakDb: null });
      const json = output.match(/\{\s*"input_i"[\s\S]*?\}/);
      try {
        const x = JSON.parse(json?.[0] || "{}"),
          i = Number(x.input_i),
          tp = Number(x.input_tp);
        resolve({
          lufs: Number.isFinite(i) ? i : null,
          truePeakDb: Number.isFinite(tp) ? tp : null,
        });
      } catch {
        resolve({ lufs: null, truePeakDb: null });
      }
    });
  });
}
/** @param {Parameters<typeof verify>[0]} binding @param {string} directory @param {{start:number,end:number}|undefined} [range] */
async function analyze(binding, directory, range) {
  await verify(binding);
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, key(["analysis-v2", binding, range]) + ".json");
  try {
    const cached = await fs.lstat(filename);
    if (!cached.isFile() || cached.size > 2 * 1024 * 1024)
      throw new SyntaxError("Invalid analysis cache.");
    const result = analysisSchema.parse(JSON.parse(await fs.readFile(filename, "utf8")));
    await verify(binding);
    return result;
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT") &&
      !(error instanceof SyntaxError) &&
      !(error instanceof Error && error.name === "ZodError")
    )
      throw error;
  }
  const info = await inspect(binding.originalPath),
    duration = Number(info.format?.duration);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 86400 ||
    !info.streams?.some((s) => s.codec_type === "audio")
  )
    throw new Error("This source has no supported audio stream.");
  const start = range?.start ?? 0,
    end = range?.end ?? duration;
  if (start < 0 || end > duration + 0.05 || end <= start)
    throw new Error("Invalid audio analysis range.");
  const length = end - start;
  const step = Math.max(0.05, length / 60000),
    bucket = Math.ceil(8000 * step),
    peaks = [];
  let count = 0,
    peak = 0,
    max = 0;
  let pending = Buffer.alloc(0);
  await decode(
    [
      "-ss",
      String(start),
      "-i",
      binding.originalPath,
      "-t",
      String(length),
      "-vn",
      "-ac",
      "2",
      "-ar",
      "8000",
    ],
    (data) => {
      const b = Buffer.concat([pending, data]),
        size = b.length - (b.length % 4);
      pending = b.subarray(size);
      for (let i = 0; i < size; i += 4) {
        const v = Math.max(
          Math.abs(b.readInt16LE(i) / 32768),
          Math.abs(b.readInt16LE(i + 2) / 32768),
        );
        peak = Math.max(peak, v);
        max = Math.max(max, v);
        if (++count >= bucket) {
          peaks.push(peak);
          peak = 0;
          count = 0;
        }
      }
    },
  );
  if (count) peaks.push(peak);
  /** @type {[number,number][]} */ const speech = [];
  let speechStart = null;
  for (let i = 0; i <= peaks.length; i++) {
    if (i < peaks.length && peaks[i] > 0.015) {
      if (speechStart === null) speechStart = (i * bucket) / 8000;
    } else if (speechStart !== null) {
      if ((i * bucket) / 8000 - speechStart >= 0.15)
        speech.push([speechStart, Math.min(length, (i * bucket) / 8000)]);
      speechStart = null;
    }
  }
  const measured = await loudness(binding, range);
  await verify(binding);
  const result = analysisSchema.parse({
    version: 1,
    duration: length,
    step: bucket / 8000,
    peaks,
    peakDb: max ? 20 * Math.log10(max) : null,
    ...measured,
    speech,
  });
  const temp = filename + "." + randomUUID() + ".tmp";
  await fs.writeFile(temp, JSON.stringify(result), { flag: "wx" });
  await fs.rename(temp, filename);
  return result;
}
/** @param {import("../core/timeline/types").ClipRecord} record @param {Parameters<typeof verify>[0]} binding @param {string} filename @param {number} fps @param {number} trackDb */
async function processClip(record, binding, filename, fps, trackDb) {
  const clip = record.clip,
    a = clip.audio ?? defaultAudio(),
    sampleRate = 48000,
    expected = Math.round(clip.duration * sampleRate),
    file = await fs.open(filename, "wx");
  await writeAll(file, header(expected, 2, sampleRate, true));
  let position = 0,
    pending = Buffer.alloc(0);
  const processor = createProcessor(a.effects, sampleRate),
    rate = clip.playbackRate ?? 1;
  const tempo = rate < 0.5 ? [0.5, rate / 0.5] : rate > 2 ? [2, rate / 2] : [rate];
  try {
    await decode(
      [
        "-ss",
        String(clip.sourceStart ?? 0),
        "-i",
        binding.originalPath,
        "-t",
        String((clip.sourceEnd ?? clip.duration) - (clip.sourceStart ?? 0)),
        "-vn",
        "-ac",
        "2",
        "-ar",
        String(sampleRate),
        "-af",
        tempo.map((r) => "atempo=" + r).join(","),
      ],
      async (data) => {
        const raw = Buffer.concat([pending, data]),
          size = raw.length - (raw.length % 4);
        pending = raw.subarray(size);
        const frames = Math.min(size / 4, Math.max(0, expected - position)),
          out = Buffer.alloc(frames * 8);
        for (let frame = 0; frame < frames; frame++) {
          const i = frame * 4,
            gain = clipGain(clip, position / sampleRate, fps, trackDb),
            pan = a.pan;
          const [l, r] = processor(
            (raw.readInt16LE(i) / 32768) * gain,
            (raw.readInt16LE(i + 2) / 32768) * gain,
          );
          out.writeFloatLE(l * (pan > 0 ? Math.cos((pan * Math.PI) / 2) : 1), frame * 8);
          out.writeFloatLE(r * (pan < 0 ? Math.cos((-pan * Math.PI) / 2) : 1), frame * 8 + 4);
          position++;
        }
        if (out.length) await writeAll(file, out);
      },
    );
    if (position < expected) {
      const zeros = Buffer.alloc(65536);
      while (position < expected) {
        const n = Math.min(expected - position, zeros.length / 8);
        await writeAll(file, zeros.subarray(0, n * 8));
        position += n;
      }
    }
  } finally {
    await file.close();
  }
}
/** @param {import("../core/project/types").Project} project @param {Parameters<typeof verify>[0][]} bindings @param {string} directory */
async function mix(project, bindings, directory) {
  if (project.duration > 7200)
    throw new Error("Audio mix preparation currently supports projects up to two hours.");
  await fs.mkdir(directory, { recursive: true });
  for (const b of bindings) await verify(b);
  const identity = key([
    "mix-v2",
    project.fps,
    project.duration,
    project.tracks,
    project.scenes,
    bindings,
  ]);
  const target = path.join(directory, identity + ".wav");
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.size !== 44 + Math.round(project.duration * 48000) * 4)
      throw new Error("Invalid audio cache entry. Clear the audio cache and retry.");
    return target;
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  const scratch = await fs.mkdtemp(path.join(directory, "job-"));
  const records = [...createTimelineIndex(project).clips.values()].filter(
    (r) =>
      audibleTrack(project, r.track) &&
      !r.clip.muted &&
      !(r.layer && "muted" in r.layer.properties && r.layer.properties.muted) &&
      (r.clip.audioOnly || r.asset?.type === "audio" || r.asset?.type === "video"),
  );
  if (records.length > 128)
    throw new Error("Mix preparation currently supports up to 128 audible clips.");
  /** @type {{filename:string,start:number}[]} */ const paths = [];
  /** @type {string|undefined} */ let pendingOutput;
  try {
    for (let i = 0; i < records.length; i++) {
      const r = records[i],
        b = bindings.find((b) => b.id === r.asset?.id);
      if (!b) throw new Error("Relink missing audio before preparing the mix.");
      const info = await inspect(b.originalPath);
      if (!info.streams?.some((s) => s.codec_type === "audio")) continue;
      const filename = path.join(scratch, i + ".wav");
      const effective = {
        ...r,
        clip: {
          ...r.clip,
          volume:
            r.clip.volume ??
            (r.layer && "volume" in r.layer.properties ? r.layer.properties.volume : 1),
        },
      };
      await processClip(effective, b, filename, project.fps, r.track.gainDb ?? 0);
      paths.push({ filename, start: r.clip.start });
    }
    const temporary = target + "." + randomUUID() + ".tmp";
    pendingOutput = temporary;
    const samples = Math.round(project.duration * 48000),
      file = await fs.open(temporary, "wx");
    await writeAll(file, header(samples));
    let written = 0;
    try {
      if (paths.length) {
        const args = paths.flatMap((p) => ["-i", p.filename]);
        const filters = paths.map(
          (p, i) =>
            `[${i}:a]adelay=${Math.round(p.start * 48000)}S|${Math.round(p.start * 48000)}S,apad,atrim=duration=${project.duration}[a${i}]`,
        );
        filters.push(
          paths.map((_, i) => `[a${i}]`).join("") +
            `amix=inputs=${paths.length}:normalize=1:dropout_transition=0,apad,atrim=duration=${project.duration}[out]`,
        );
        let mixRemainder = Buffer.alloc(0);
        await decode(
          [
            ...args,
            "-filter_complex",
            filters.join(";"),
            "-map",
            "[out]",
            "-ac",
            "2",
            "-ar",
            "48000",
          ],
          async (data) => {
            const b = Buffer.concat([mixRemainder, data]),
              aligned = b.length - (b.length % 4);
            mixRemainder = b.subarray(aligned);
            const frames = Math.min(aligned / 4, samples - written / 4);
            if (frames <= 0) return;
            const out = Buffer.alloc(frames * 4),
              ceiling = dbToGain(-1);
            for (let i = 0; i < frames * 2; i++) {
              const value = (b.readInt16LE(i * 2) / 32768) * paths.length;
              out.writeInt16LE(
                Math.round(Math.max(-ceiling, Math.min(ceiling, value)) * 32767),
                i * 2,
              );
            }
            await writeAll(file, out);
            written += out.length;
          },
          false,
        );
      }
      const zero = Buffer.alloc(65536);
      while (written < samples * 4) {
        const n = Math.min(zero.length, samples * 4 - written);
        await writeAll(file, zero.subarray(0, n));
        written += n;
      }
    } finally {
      await file.close();
    }
    for (const b of bindings) await verify(b);
    await fs.rename(temporary, target);
    pendingOutput = undefined;
    await trimCache(directory, target);
    return target;
  } finally {
    if (pendingOutput) await fs.unlink(pendingOutput).catch(() => {});
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
/** @param {string} directory @param {string} current */
async function trimCache(directory, current) {
  const entries = [];
  for (const name of await fs.readdir(directory)) {
    if (!/^[a-f0-9]{64}\.wav$/.test(name)) continue;
    const filename = path.join(directory, name),
      s = await fs.stat(filename);
    entries.push({ filename, size: s.size, at: s.mtimeMs });
  }
  entries.sort((a, b) => b.at - a.at);
  let bytes = entries.reduce((n, e) => n + e.size, 0);
  for (const entry of entries.slice(2).reverse()) {
    if (bytes < 2 * 1024 ** 3) break;
    if (entry.filename === current) continue;
    try {
      await fs.unlink(entry.filename);
      bytes -= entry.size;
    } catch {
      /* An active Windows media handle may retain this cache entry. */
    }
  }
}
module.exports = { analyze, mix, verify, decode, header, key };

/** @param {string} filename */
async function inspect(filename) {
  return require("zod")
    .z.object({
      streams: require("zod").z.array(
        require("zod").z.object({ codec_type: require("zod").z.string() }),
      ),
      format: require("zod").z.object({
        duration: require("zod").z.coerce.number().positive().max(86400),
      }),
    })
    .parse(await probe(filename));
}

/** @param {import("node:fs/promises").FileHandle} file @param {Buffer} buffer */
async function writeAll(file, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, null);
    if (!bytesWritten) throw new Error("Could not write prepared audio. Check disk space.");
    offset += bytesWritten;
  }
}
