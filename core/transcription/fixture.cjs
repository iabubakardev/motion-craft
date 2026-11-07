const randomUUID = () => globalThis.crypto.randomUUID();
function fixture() {
  const jobId = randomUUID();
  const segments = [
    {
      id: 0,
      start: 0.111,
      end: 0.822,
      text: "Hello world",
      words: [{ start: 0.111, end: 0.822, text: "Hello world", probability: 0.98 }],
    },
  ];
  const result = {
    jobId,
    audioPath: "D:\\media\\test.mp3",
    language: "en",
    languageProbability: 0.99,
    duration: 1,
    model: "tiny",
    device: "cpu",
    computeType: "int8",
    segments,
    execution: {
      startedAt: "2026-11-06T10:00:00Z",
      elapsedSeconds: 1,
      fasterWhisperVersion: "1.2.1",
      options: { beamSize: 1, wordTimestamps: true, vadFilter: true, language: null },
      actualDevice: "cpu",
      actualComputeType: "int8",
    },
  };
  const { audioPath, ...safe } = result;
  void audioPath;
  return {
    result,
    transcript: {
      version: 1,
      id: jobId,
      assetId: randomUUID(),
      source: { filename: "test.mp3", size: 1, modifiedAt: 1 },
      result: safe,
      originalSegments: segments,
      captionIds: [],
    },
  };
}
module.exports = { fixture };
