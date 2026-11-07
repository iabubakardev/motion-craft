// Real Electron acceptance; isolated media/profile and substituted native dialogs.
const { app, dialog } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { header } = require("../workers/audio-processing.cjs");
const directory = fs.mkdtempSync(path.join(__dirname, "../.next/audio-mixing-smoke-"));
app.setPath("userData", path.join(directory, "profile"));
const rate = 48000;
for (const [name, freq, amp] of [
  ["narration.wav", 440, 0.2],
  ["music.wav", 220, 0.1],
]) {
  const pcm = Buffer.alloc(rate * 4 * 4);
  for (let i = 0; i < rate * 4; i++) {
    const v = Math.round(Math.sin((i / rate) * freq * Math.PI * 2) * amp * 32767);
    pcm.writeInt16LE(v, i * 4);
    pcm.writeInt16LE(v, i * 4 + 2);
  }
  fs.writeFileSync(path.join(directory, name), Buffer.concat([header(rate * 4), pcm]));
}
let destination = path.join(directory, "audio.motioncraft.json");
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [path.join(directory, "narration.wav"), path.join(directory, "music.wav")],
});
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showMessageBoxSync = () => 1;
const timer = setTimeout(() => finish(new Error("Audio mixing acceptance timed out")), 180000);
function finish(e) {
  clearTimeout(timer);
  if (e) console.error(e);
  app.exit(e ? 1 : 0);
}
app.once("browser-window-created", (_, w) =>
  w.webContents.once("did-finish-load", async () => {
    const evaluate = (s) => w.webContents.executeJavaScript(s, true),
      wait = async (s) => {
        for (let i = 0; i < 900; i++) {
          const value = await evaluate(s);
          if (value) return value;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("Timed out: " + s);
      };
    const click = async (label) => {
      const p = `e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim().replace(/^\\+\\s*/,'')===${JSON.stringify(label)}`;
      await wait(`Array.from(document.querySelectorAll('button')).some(e=>(${p})&&!e.disabled)`);
      await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>${p}).click()`);
    };
    const exported = () =>
      evaluate(
        `(async()=>{const make=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;URL.createObjectURL=b=>{blob=b;return make.call(URL,b)};HTMLAnchorElement.prototype.click=()=>{};try{document.querySelector('[aria-label="Export JSON"]').click()}finally{URL.createObjectURL=make;HTMLAnchorElement.prototype.click=click}return JSON.parse(await blob.text())})()`,
      );
    const select = async (label, value) =>
      evaluate(
        `(()=>{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    try {
      await click("Import media");
      await wait(
        `window.motioncraft.media.listAssets().then(a=>a.length===2&&a.every(x=>x.duration>0))`,
      );
      const initial = await exported(),
        tracks = initial.tracks.filter((t) => t.type === "audio");
      for (const [name, track] of [
        ["narration.wav", tracks[0]],
        ["music.wav", tracks[1]],
      ]) {
        await evaluate(
          `(()=>{const card=Array.from(document.querySelectorAll('ul[aria-label="Imported media"] button')).find(e=>e.textContent.includes('${name}')),data=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));const row=document.querySelector('[data-track-id="${track.id}"]'),r=row.getBoundingClientRect();row.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:r.left+196,clientY:r.top+15}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));})()`,
        );
        await wait(`document.querySelector('[data-track-id="${track.id}"] [data-clip-id]')`);
      }
      await click("Timeline");
      await wait(
        `document.querySelectorAll('canvas[aria-label="Source waveform peaks"]').length===2`,
      );
      let p = await exported(),
        narration = p.tracks.find((t) => t.id === tracks[0].id).clips[0],
        music = p.tracks.find((t) => t.id === tracks[1].id).clips[0];
      await evaluate(`document.querySelector('[data-clip-id="${music.id}"]').click()`);
      await click("Basic");
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Clip gain dB"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'-9');e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`,
      );
      await wait(
        `document.querySelector('[aria-label="Clip gain dB"]').getAttribute('value')==='-9'`,
      );
      await evaluate(
        `document.querySelector('[aria-label="Fade in ${music.id}"]').scrollIntoView({block:'nearest',inline:'nearest'})`,
      );
      const handle = await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Fade in ${music.id}"]'),r=e.getBoundingClientRect(),c=e.parentElement.getBoundingClientRect();return{x:r.x+6,y:r.y+6,dx:c.width*.1,height:innerHeight}})()`,
      );
      w.webContents.sendInputEvent({
        type: "mouseDown",
        x: Math.round(handle.x),
        y: Math.round(handle.y),
        button: "left",
        clickCount: 1,
      });
      w.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(handle.x + handle.dx),
        y: Math.round(handle.y),
        button: "left",
      });
      w.webContents.sendInputEvent({
        type: "mouseUp",
        x: Math.round(handle.x + handle.dx),
        y: Math.round(handle.y),
        button: "left",
        clickCount: 1,
      });
      await new Promise((r) => setTimeout(r, 200));
      await wait(`Number(document.querySelector('[aria-label="Audio fadeIn"]').value)>.2`);
      console.log("CHECK: fade applied");
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Timeline preview position"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'30');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click("Add volume key at playhead");
      p = await exported();
      assert.equal(p.tracks.find((t) => t.id === tracks[1].id).clips[0].audio.keys.length, 1);
      const keyHandle = await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Volume keyframe 30"]');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),c=e.parentElement.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,dx:c.width*.1}})()`,
      );
      w.webContents.sendInputEvent({
        type: "mouseDown",
        x: Math.round(keyHandle.x),
        y: Math.round(keyHandle.y),
        button: "left",
        clickCount: 1,
      });
      w.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(keyHandle.x + keyHandle.dx),
        y: Math.round(keyHandle.y + 2),
        button: "left",
      });
      w.webContents.sendInputEvent({
        type: "mouseUp",
        x: Math.round(keyHandle.x + keyHandle.dx),
        y: Math.round(keyHandle.y + 2),
        button: "left",
        clickCount: 1,
      });
      await wait(`!document.querySelector('[aria-label="Volume keyframe 30"]')`);
      p = await exported();
      assert.ok(p.tracks.find((t) => t.id === tracks[1].id).clips[0].audio.keys[0].frame > 30);
      await evaluate(
        `document.querySelector('button[aria-label^="Volume keyframe "]').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}))`,
      );
      await wait(`!document.querySelector('button[aria-label^="Volume keyframe "]')`);
      assert.equal(
        (await exported()).tracks.find((t) => t.id === tracks[1].id).clips[0].audio.keys.length,
        0,
      );
      await click("Undo");
      await wait(`!!document.querySelector('button[aria-label^="Volume keyframe "]')`);

      await evaluate(
        `Array.from(document.querySelectorAll('details')).find(e=>e.querySelector('summary')?.textContent==='Automatic music ducking').open=true`,
      );
      await select("Narration ducking track", tracks[0].id);
      await select("Music ducking track", tracks[1].id);
      await click("Generate ducking automation");
      await wait(`!!document.querySelector('dialog[aria-label="Replace music automation?"]')`);
      await click("Replace automation");
      await wait(`document.body.textContent.includes('Editable ducking keys generated')`);
      p = await exported();
      assert.ok(
        p.tracks
          .find((t) => t.id === tracks[1].id)
          .clips[0].audio.keys.every((k) => k.origin === "ducking"),
      );
      await evaluate(`document.querySelector('[data-clip-id="${narration.id}"]').click()`);
      await click("Basic");
      await evaluate(
        `Array.from(document.querySelectorAll('details')).find(e=>e.querySelector('summary')?.textContent==='Loudness normalization').open=true`,
      );
      await click("Analyze clip loudness");
      await wait(
        `document.querySelector('[aria-label="Audio editing"]').textContent.includes('Before:')`,
      );
      await click("Normalize to LUFS");
      await click("Analyze processed clip");
      await wait(
        `document.querySelector('[aria-label="Audio editing"]').textContent.includes('Processed result:')`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('details')).find(e=>e.querySelector('summary')?.textContent==='Audio effects').open=true`,
      );
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Audio effect highpass"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'80');e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`,
      );
      await wait(
        `document.querySelector('[aria-label="Audio effect highpass"]').getAttribute('value')==='80'`,
      );
      p = await exported();
      const prepared = await evaluate(`window.motioncraft.audio.mix(${JSON.stringify(p)})`);
      assert.match(prepared.url, /^motioncraft-media:\/\/asset\//);
      await wait(`document.querySelector('audio[src="${prepared.url}"]')`);
      fs.writeFileSync(
        path.join(directory, "audio-mixer.png"),
        (await w.webContents.capturePage()).toPNG(),
      );
      const saved = await evaluate(`window.motioncraft.projects.save(${JSON.stringify(p)},true)`);
      assert.equal(saved.status, "saved");
      const { createMediaLibrary } = require("./media-library.cjs"); // Persistence bytes are also schema validated.
      void createMediaLibrary;
      assert.deepEqual(
        require("../core/project/schema.cjs").parseProjectJSON(fs.readFileSync(destination, "utf8"))
          .project,
        p,
      );
      destination = path.join(directory, "mixed.mp4");
      await evaluate(
        `window.motioncraft.render.start(${JSON.stringify({ ...p, resolution: { width: 640, height: 360 }, aspectRatio: "16:9" })})`,
      );
      const job = await wait(
        `window.motioncraft.render.status().then(j=>j&&['completed','failed'].includes(j.state)?j:false)`,
      );
      assert.equal(job.state, "completed", JSON.stringify(job));
      const reference = Buffer.from(
        await evaluate(
          `fetch('${prepared.url}').then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))`,
        ),
      );
      const decoded = require("node:child_process").execFileSync(
        require("./render-binaries.cjs").binary("ffmpeg"),
        [
          "-v",
          "error",
          "-i",
          destination,
          "-vn",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          "-f",
          "wav",
          "pipe:1",
        ],
        { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      );
      const dataOffset = (b) => {
        let i = 12;
        while (i + 8 <= b.length) {
          if (b.toString("ascii", i, i + 4) === "data") return i + 8;
          i += 8 + b.readUInt32LE(i + 4) + (b.readUInt32LE(i + 4) % 2);
        }
        throw new Error("Missing PCM chunk");
      };
      const rms = (b) => {
        const start = dataOffset(b);
        let sum = 0,
          count = 0;
        for (let i = 48000; i < 96000; i++) {
          sum += (b.readInt16LE(start + i * 4) / 32768) ** 2;
          count++;
        }
        return Math.sqrt(sum / count);
      };
      assert.ok(
        Math.abs(rms(decoded) / rms(reference) - 1) < 0.1,
        "Encoded AAC must retain the prepared preview mix level",
      );
      await click("Solo track");
      let solo = await exported();
      assert.equal(solo.tracks.find((t) => t.id === tracks[0].id).solo, true);
      await click("Undo");
      await click("Mute clip");
      let muted = await exported();
      assert.equal(muted.tracks.find((t) => t.id === tracks[0].id).clips[0].muted, true);
      await click("Undo");
      const crossFixture = {
        ...p,
        duration: 8,
        tracks: p.tracks.map((t) =>
          t.id === tracks[0].id
            ? {
                ...t,
                clips: [
                  { ...narration, audio: p.tracks.find((a) => a.id === t.id).clips[0].audio },
                  {
                    ...p.tracks.find((a) => a.id === tracks[1].id).clips[0],
                    start: 4,
                    trackId: t.id,
                  },
                ],
              }
            : t.id === tracks[1].id
              ? { ...t, clips: [] }
              : t,
        ),
      };
      await click("Import JSON");
      await wait(`!!document.querySelector('textarea[aria-label="Project JSON"]')`);
      await evaluate(
        `(()=>{const e=document.querySelector('textarea[aria-label="Project JSON"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(JSON.stringify(crossFixture))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click("Validate and review");
      await wait(`!!document.querySelector('dialog[aria-label="Review project import"]')`);
      await click("Replace current project");
      await wait(`!document.querySelector('dialog[aria-label="Review project import"]')`);
      await wait(`document.querySelectorAll('[data-clip-id]').length===2`);
      await evaluate(
        `(()=>{document.querySelector('[data-clip-id="${narration.id}"]').click();document.querySelector('[data-clip-id="${music.id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));})()`,
      );
      await click("Basic");
      await wait(`!!document.querySelector('[aria-label="Crossfade curve"]')`);
      await select("Crossfade curve", "equal-power");
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label="Crossfade duration"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      await click("Crossfade selected audio");
      let crossed = await exported(),
        crossTrack = crossed.tracks.find((t) => t.id === tracks[0].id);
      assert.equal(crossTrack.audioOverlap, true);
      assert.equal(crossTrack.clips.find((c) => c.id === music.id).start, 3);
      assert.ok(crossTrack.clips.every((c) => c.audio.fadeCurve === "equal-power"));
      await click("Undo");
      assert.equal(
        (await exported()).tracks
          .find((t) => t.id === tracks[0].id)
          .clips.find((c) => c.id === music.id).start,
        4,
      );
      console.log(
        "PASS: waveforms, gain, fade/key dragging, deletion/undo, ducking, normalization/effects, processed preview/AAC levels, persistence, crossfades and synchronized MP4 export.",
      );
      console.log("Artifacts:", directory);
      finish();
    } catch (e) {
      console.error(await evaluate("document.body.innerText.slice(-2000)").catch(() => ""));
      finish(e);
    }
  }),
);
require("./main.cjs");
