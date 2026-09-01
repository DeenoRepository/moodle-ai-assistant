const fs = require("fs");
const { JSDOM } = require("jsdom");

const contentScript = fs.readFileSync("./content/content.js", "utf8").replace(
  "  const observer = new MutationObserver((mutations) => {",
  "  window.__moodleAiTest = { detectQuestionType, extractQuestionData, autoFillAnswer, extractMediaFromElement };\n\n  const observer = new MutationObserver((mutations) => {"
);

function createDom(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    runScripts: "outside-only",
    url: "https://moodle.example/mod/quiz/attempt.php?attempt=1",
  });

  Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() { return this.textContent; },
    set(value) { this.textContent = value; },
  });
  dom.window.CSS ??= {};
  dom.window.CSS.escape ??= (value) => String(value);
  dom.window.chrome = {
    runtime: { id: "test", sendMessage: (_message, callback) => callback({}) },
    storage: {
      sync: { get: async () => ({ autofill: true }) },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
  };
  dom.window.console.log = () => {};
  dom.window.console.warn = () => {};
  dom.window.eval(contentScript);
  return dom;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const tests = [];
function test(name, callback) {
  tests.push({ name, callback });
}

test("single radio is detected and filled", () => {
  const dom = createDom(`<div class="formulation"><div class="qtext">Choose</div><input type="radio" name="q" id="a"><label for="a">Alpha</label><input type="radio" name="q" id="b"><label for="b">Beta</label></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Multiple Choice (Single)", "question type");
  api.autoFillAnswer(formulation, "Beta", "Multiple Choice (Single)");
  assertEqual(formulation.querySelector("#b").checked, true, "selected radio");
});

test("Russian true/false is detected and filled", () => {
  const dom = createDom(`<div class="formulation"><input type="radio" name="q" id="t"><label for="t">Верно</label><input type="radio" name="q" id="f"><label for="f">Неверно</label></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "True/False", "question type");
  api.autoFillAnswer(formulation, "Неверно", "True/False");
  assertEqual(formulation.querySelector("#f").checked, true, "selected false radio");
});

test("single dropdown is detected and filled", () => {
  const dom = createDom(`<div class="formulation"><select><option value="">Choose</option><option value="a">Alpha</option></select></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Dropdown", "question type");
  api.autoFillAnswer(formulation, "Alpha", "Dropdown");
  assertEqual(formulation.querySelector("select").value, "a", "selected dropdown option");
});

test("question and option media are extracted", () => {
  const dom = createDom(`<div class="formulation"><div class="qtext">Pick media</div><label><input type="radio"><img id="image" src="/option.png" alt="Image option"></label><audio src="/sound.mp3"></audio><video><source src="/clip.mp4" type="video/mp4"></video></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  Object.defineProperty(formulation.querySelector("#image"), "naturalWidth", { value: 100 });
  Object.defineProperty(formulation.querySelector("#image"), "naturalHeight", { value: 100 });
  const data = api.extractQuestionData(formulation);
  assertEqual(data.media.map((item) => item.type).sort().join(","), "audio,image,video", "media types");
  assertEqual(data.options[0], "Image option", "image option alt text");
});

test("Unicode ordering text is matched", () => {
  const dom = createDom(`<div class="formulation"><div>Второй пункт<select><option value="1">1</option><option value="2">2</option></select></div><div>Первый пункт<select><option value="1">1</option><option value="2">2</option></select></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  api.autoFillAnswer(formulation, "1. Первый пункт\n2. Второй пункт", "Ordering");
  assertEqual([...formulation.querySelectorAll("select")].map((select) => select.value).join(","), "2,1", "ordering values");
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
