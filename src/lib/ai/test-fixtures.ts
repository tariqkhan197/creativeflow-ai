/** Shared test data for the AI modules (imported by tests only). */
export const validScript = {
  title: "First Mile",
  logline: "A new runner discovers the shoe that makes the first mile easy.",
  totalSeconds: 30,
  scenes: [
    {
      heading: "Alarm",
      seconds: 10,
      visuals: "5:30am, a phone alarm lights a dark bedroom.",
      voiceover: "Every runner starts somewhere.",
      dialogue: [],
      onScreenText: null,
      audio: "Soft piano",
    },
    {
      heading: "The run",
      seconds: 20,
      visuals: "Sunrise. Our runner finds her stride.",
      voiceover: null,
      dialogue: [{ speaker: "Runner", line: "That wasn't so hard." }],
      onScreenText: "Start your first mile.",
      audio: null,
    },
  ],
};
