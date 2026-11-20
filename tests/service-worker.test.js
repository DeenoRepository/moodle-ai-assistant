const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "background", "service-worker.js"), "utf8");
const sandbox = {
  chrome: {
    runtime: { onMessage: { addListener: () => {} } },
    storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  },
  console,
  URL,
  Set,
  JSON,
  Uint8Array,
  btoa,
  fetch: async () => ({}),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  `${source}\n;globalThis.__swTest = { deriveChatCompletionsEndpoint, deriveModelsEndpoint, extractModelIds, normalizeApiAnswer, buildUserPrompt, convertMessageToOpenAI, messagesContainAudio };`,
  sandbox
);
const api = sandbox.__swTest;

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}: expected ${e}, got ${a}`);
  }
}

const tests = [];
function test(name, callback) {
  tests.push({ name, callback });
}

test("base URL derives chat completions endpoint", () => {
  const endpoint = api.deriveChatCompletionsEndpoint(new URL("https://example.com"));
  assertEqual(endpoint.toString(), "https://example.com/v1/chat/completions", "chat endpoint");
});

test("models URL is converted to chat completions endpoint", () => {
  const endpoint = api.deriveChatCompletionsEndpoint(new URL("https://example.com/api/v1/models"));
  assertEqual(endpoint.pathname, "/api/v1/chat/completions", "chat endpoint path");
});

test("chat completions URL derives models endpoint", () => {
  const models = api.deriveModelsEndpoint(new URL("https://example.com/v1/chat/completions"));
  assertEqual(models.pathname, "/v1/models", "models endpoint path");
});

test("model ids are extracted from OpenAI-style and plain lists", () => {
  assertEqual(api.extractModelIds({ data: [{ id: "b-model" }, { id: "a-model" }, { id: "a-model" }] }), ["a-model", "b-model"], "OpenAI list");
  assertEqual(api.extractModelIds(["x", "y"]), ["x", "y"], "plain list");
  assertEqual(api.extractModelIds({}), [], "empty payload");
});

test("normalizeApiAnswer handles string and array content", () => {
  assertEqual(api.normalizeApiAnswer("  Yes  "), "Yes", "string content");
  assertEqual(api.normalizeApiAnswer([{ type: "text", text: "A" }, { type: "text", text: "B" }]), "AB", "array content");
  assertEqual(api.normalizeApiAnswer(undefined), "", "missing content");
});

test("answer prompt does not request hidden reasoning", () => {
  const prompt = api.buildUserPrompt({ type: "True/False", text: "Water boils at 100 C at sea level." }, null, [], []);
  if (/<reasoning>|step-by-step|show your thoughts/i.test(prompt)) {
    throw new Error("prompt still requests step-by-step reasoning");
  }
  if (!/<answer>/.test(prompt)) {
    throw new Error("prompt does not define the <answer> tag");
  }
});

test("drag into text prompt gives each gap only its own group's words", () => {
  const prompt = api.buildUserPrompt({
    type: "Drag into Text",
    text: "Внутри заряженности сферы [Gap 1], поэтому [Gap 2].",
    dropGroups: [
      { place: 1, group: "1", words: ["не содержатся", "очень много"] },
      { place: 2, group: "2", words: ["E=0", "E>0"] },
    ],
  }, "", [], []);
  assertEqual(prompt.includes("[Gap 1]: choose one of: не содержатся | очень много"), true, "gap 1 words");
  assertEqual(prompt.includes("[Gap 2]: choose one of: E=0 | E>0"), true, "gap 2 words");
});

test("physics hint is only added for kinetic energy questions", () => {
  const plain = api.buildUserPrompt({ type: "Short Answer", text: "Find the density of water." }, null, [], []);
  const kinetic = api.buildUserPrompt({ type: "Short Answer", text: "Найдите кинетическая энергия теплового движения молекул." }, null, [], []);
  if (plain.includes("1.5 * ν * R * T")) throw new Error("hint leaked into unrelated question");
  if (!kinetic.includes("1.5 * ν * R * T")) throw new Error("hint missing for kinetic energy question");
});

test("audio is sent as input_audio, or as a text note when audioAsText is set", () => {
  const message = {
    role: "user",
    parts: [
      { text: "Listen" },
      { inline_data: { media_type: "audio", mime_type: "audio/mpeg", data: "AAA", label: "clip" } },
    ],
  };
  const native = api.convertMessageToOpenAI(message);
  assertEqual(native.content.some((part) => part.type === "input_audio"), true, "native audio part");
  const fallback = api.convertMessageToOpenAI(message, { audioAsText: true });
  assertEqual(fallback.content.some((part) => part.type === "input_audio"), false, "no audio part in fallback");
  assertEqual(api.messagesContainAudio([message]), true, "audio detected");
});

let failures = 0;
for (const { name, callback } of tests) {
  try {
    callback();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}: ${error.message}`);
  }
}

console.log(`${tests.length - failures}/${tests.length} tests passed`);
process.exitCode = failures ? 1 : 0;
