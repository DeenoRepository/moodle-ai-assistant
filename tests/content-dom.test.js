const fs = require("fs");
const { JSDOM } = require("jsdom");

const contentScript = fs.readFileSync("./content/content.js", "utf8").replace(
  "  const observer = new MutationObserver((mutations) => {",
  "  window.__moodleAiTest = { detectQuestionType, extractQuestionData, autoFillAnswer, extractMediaFromElement, findNextPageButton, findSharedDescription, getSharedContextData };\n\n  const observer = new MutationObserver((mutations) => {"
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

test("auto-answer picks Next page and never Finish attempt", () => {
  const onlyFinish = createDom(`<form><input type="submit" name="finishattempt" value="Finish attempt ..."></form>`);
  assertEqual(onlyFinish.window.__moodleAiTest.findNextPageButton(), null, "no next button on last page");

  const withNext = createDom(`<form><input type="submit" name="finishattempt" value="Finish attempt ..."><input type="submit" name="next" value="Next page"></form>`);
  const next = withNext.window.__moodleAiTest.findNextPageButton();
  assertEqual(next && next.name, "next", "next button selected");
});

test("Moodle multianswer cloze gets per-gap options and fills by number", () => {
  const dom = createDom(`<div class="que multianswer"><div class="content"><div class="formulation clearfix"><h4 class="accesshide">Текст вопроса</h4><p>I <span class="subquestion"><label class="subq accesshide" for="s1">Ответ 1</label><select id="s1" name="s1"><option value="">&nbsp;</option><option value="0">am</option><option value="1">is</option></select></span> a mechanic. I <span class="subquestion"><label class="subq accesshide" for="s2">Ответ 2</label><select id="s2" name="s2"><option value="">&nbsp;</option><option value="0">repair</option><option value="1">repaired</option></select></span> cars.</p></div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Embedded Cloze", "question type");
  const data = api.extractQuestionData(formulation);
  assertEqual(data.text.includes("[Gap 1]") && data.text.includes("[Gap 2]"), true, "gaps are numbered in text");
  assertEqual(data.text.includes("Текст вопроса") || data.text.includes("Ответ 1"), false, "hidden labels removed");
  assertEqual(data.gapCount, 2, "gap count");
  assertEqual(data.gapOptions[1].join(","), "repair,repaired", "per-gap options");
  api.autoFillAnswer(formulation, "1: is\n2: repaired", "Embedded Cloze");
  const selects = formulation.querySelectorAll("select");
  assertEqual(selects[0].value, "1", "gap 1 filled");
  assertEqual(selects[1].value, "1", "gap 2 filled");
});

test("cloze with a free-text blank is numbered and the blank is filled", () => {
  const dom = createDom(`<div class="que multianswer"><div class="formulation clearfix"><p>I <span class="subquestion"><select id="s1" name="s1"><option value="">&nbsp;</option><option value="0">have</option><option value="1">has</option></select></span> already <span class="subquestion"><input type="text" name="s2" id="s2" size="4" /></span> many repairs. I <span class="subquestion"><select id="s3" name="s3"><option value="">&nbsp;</option><option value="0">am</option><option value="1">is</option></select></span> sure.</p></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Embedded Cloze", "question type");
  const data = api.extractQuestionData(formulation);
  assertEqual(data.gapCount, 3, "three gaps including the text blank");
  assertEqual(data.gapOptions[1], null, "text blank has no options");
  assertEqual(data.text.includes("[Gap 2]"), true, "text blank numbered in question text");
  api.autoFillAnswer(formulation, "1: have\n2: many\n3: am", "Embedded Cloze");
  assertEqual(formulation.querySelector("#s1").value, "0", "dropdown gap 1 filled");
  assertEqual(formulation.querySelector("#s2").value, "many", "text gap 2 filled");
  assertEqual(formulation.querySelector("#s3").value, "0", "dropdown gap 3 filled");
});

test("Moodle drag-and-drop image question is detected and answered via hidden place inputs", () => {
  const dom = createDom(`<div class="que ddimageortext"><div class="content"><div class="formulation clearfix"><div class="qtext">Match the parts</div><div class="ddarea"><div class="droparea"><div class="dropzones"></div></div><div class="draghomes"><div class="group1 draghome choice1">Wheel</div><div class="group1 draghome choice2">Bonnet</div><div class="group1 draghome choice3">Tyre</div></div><input type="hidden" id="p1" name="q:1_p1" class="placeinput place1 group1" /><input type="hidden" id="p2" name="q:1_p2" class="placeinput place2 group1" /><input type="hidden" id="p3" name="q:1_p3" class="placeinput place3 group1" /></div></div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Drag and Drop (Image)", "question type");
  const data = api.extractQuestionData(formulation);
  assertEqual(data.dragItems.join(","), "Wheel,Bonnet,Tyre", "labels");
  assertEqual(data.dropPlaces.join(","), "1,2,3", "places");
  // Stand-in for Moodle's drag handler: on mouseup over a dropzone, it marks the drag as placed in that place.
  const doc = dom.window.document;
  doc.addEventListener("mouseup", (e) => {
    const drag = [...doc.querySelectorAll(".draghome")].find((el) => el.dataset.active === "1");
    const drop = e.target.closest?.(".dropzone");
    if (!drag || !drop) return;
    drag.dataset.active = "";
    const place = drop.className.match(/place(\d+)/)[1];
    drag.classList.add("placed", `inplace${place}`);
    doc.querySelector(`input.place${place}`).value = drag.className.match(/choice(\d+)/)[1];
  });
  doc.addEventListener("mousedown", (e) => {
    doc.querySelectorAll(".draghome").forEach((el) => delete el.dataset.active);
    const drag = e.target.closest(".draghome");
    if (drag) drag.dataset.active = "1";
  });
  const zones = [1, 2, 3].map((n) => {
    const zone = doc.createElement("div");
    zone.className = `dropzone place${n} group1`;
    Object.defineProperty(zone, "getBoundingClientRect", { value: () => ({ left: n * 100, top: 0, width: 50, height: 50 }) });
    doc.querySelector(".dropzones").appendChild(zone);
    return zone;
  });
  doc.querySelectorAll(".draghome").forEach((el) => {
    Object.defineProperty(el, "getBoundingClientRect", { value: () => ({ left: 0, top: 200, width: 60, height: 20 }) });
  });

  return api.autoFillAnswer(formulation, "1: Tyre\n2: Wheel\n3: Bonnet", "Drag and Drop (Image)").then(() => {
    assertEqual(doc.querySelector("#p1").value, "3", "place 1 gets Tyre (choice3)");
    assertEqual(doc.querySelector("#p2").value, "1", "place 2 gets Wheel (choice1)");
    assertEqual(doc.querySelector("#p3").value, "2", "place 3 gets Bonnet (choice2)");
  });
});

test("drag-and-drop ignores dragplaceholder copies and drags only real labels", async () => {
  const dom = createDom(`<div class="que ddimageortext"><div class="formulation clearfix"><div class="ddarea"><div class="droparea"><div class="dropzones"></div></div><div class="draghomes"><div class="group1 draghome dragplaceholder choice1">Wheel</div><div class="group1 draghome choice1">Wheel</div><div class="group1 draghome dragplaceholder choice2">Bonnet</div><div class="group1 draghome choice2">Bonnet</div></div><input type="hidden" name="q:1_p1" class="placeinput place1 group1" /><input type="hidden" name="q:1_p2" class="placeinput place2 group1" /></div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const doc = dom.window.document;
  const formulation = doc.querySelector(".formulation");
  const seenMouseDown = [];
  doc.addEventListener("mousedown", (e) => seenMouseDown.push(e.target.className));
  let lastDrag = null;
  doc.addEventListener("mousedown", (e) => { lastDrag = e.target; });
  doc.addEventListener("mouseup", (e) => {
    if (!lastDrag || !e.target.closest(".dropzone")) return;
    const place = e.target.closest(".dropzone").className.match(/place(\d+)/)[1];
    lastDrag.classList.add("placed", `inplace${place}`);
  });
  [1, 2].forEach((n) => {
    const zone = doc.createElement("div");
    zone.className = `dropzone place${n} group1`;
    Object.defineProperty(zone, "getBoundingClientRect", { value: () => ({ left: n * 100, top: 0, width: 50, height: 50 }) });
    doc.querySelector(".dropzones").appendChild(zone);
  });
  doc.querySelectorAll(".draghome").forEach((el) => {
    const width = el.classList.contains("dragplaceholder") ? 0 : 60;
    Object.defineProperty(el, "getBoundingClientRect", { value: () => ({ left: 0, top: 200, width, height: 20 }) });
  });

  await api.autoFillAnswer(formulation, "1: Wheel\n2: Bonnet", "Drag and Drop (Image)");
  const placeholderUsed = seenMouseDown.some((cls) => cls.includes("dragplaceholder"));
  assertEqual(placeholderUsed, false, "placeholder never receives mousedown");
  assertEqual(seenMouseDown.length, 0, "no mouse drags are simulated any more");
  assertEqual(doc.querySelector("input[name='q:1_p1']").value, "1", "place 1 gets the Wheel choice");
  assertEqual(doc.querySelector("input[name='q:1_p2']").value, "2", "place 2 gets the Bonnet choice");
});

test("audio question with numbered text blanks excludes player labels and numbers the gaps", () => {
  const dom = createDom(`<div class="que multianswer"><div class="formulation clearfix"><div class="audioplayer"><div class="mejs__container"><div class="mejs__controls">Text Color: White Font Size: 100%</div></div></div><p>Mechanic 1: Yes, (1) <input type="text" name="a1" /> the windshield. Mechanic 2: Are the (2) <input type="text" name="a2" />?</p></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  const data = api.extractQuestionData(formulation);
  assertEqual(data.text.includes("Font Size"), false, "player settings removed from question text");
  assertEqual(data.text.includes("[Gap 1]") && data.text.includes("[Gap 2]"), true, "text blanks numbered as gaps");
});

test("shared passage split into shortanswer questions gets its own numbered line", () => {
  const passage = `<p>but (1) ___ the windshield. Are the (2) ___?</p>`;
  const dom = createDom(`<div class="que shortanswer"><div class="formulation clearfix"><div class="qtext">${passage}</div><input type="text" name="a1" /></div></div><div class="que shortanswer"><div class="formulation clearfix"><div class="qtext">${passage}</div><input type="text" name="a2" /></div></div>`);
  const api = dom.window.__moodleAiTest;
  const doc = dom.window.document;
  const [first, second] = [...doc.querySelectorAll(".formulation")];
  const answer = "1: There's a crack in\n2: Side mirrors";
  api.autoFillAnswer(first, answer, "Short Answer");
  api.autoFillAnswer(second, answer, "Short Answer");
  assertEqual(doc.querySelector("input[name='a1']").value, "There's a crack in", "blank 1 gets line 1");
  assertEqual(doc.querySelector("input[name='a2']").value, "Side mirrors", "blank 2 gets line 2");
});

test("context audio is excluded from the preceding description block", () => {
  const dom = createDom(`<div class="que description"><div class="formulation clearfix"><div class="qtext"><audio src="/clip.mp3"></audio></div></div></div><div class="que shortanswer"><div class="formulation clearfix"><div class="qtext">but (1) ___ the windshield.</div><input type="text" name="a1" /></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelectorAll(".formulation")[1];
  const own = api.extractQuestionData(formulation).media.filter((m) => m.type === "audio");
  assertEqual(own.length, 0, "question has no audio of its own");
  const shared = api.getSharedContextData(formulation).media;
  assertEqual(shared.length, 0, "context audio is not inherited");
});

test("pinned context for a blank question uses the full dialogue from the description block", () => {
  const dialogue = "Mechanic 1: Okay, the hood is fine, but (1) ___ the windshield. Mechanic 2: Cracked windshield. Are the (2) ___?";
  const dom = createDom(`<div class="que description"><div class="formulation clearfix"><div class="qtext">${dialogue}</div></div></div><div class="que shortanswer"><div class="formulation clearfix"><div class="qtext">but (2) ___ the windshield.</div><input type="text" name="a2" /></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelectorAll(".formulation")[1];
  const shared = api.findSharedDescription(formulation);
  assertEqual(!!shared, true, "description block found");
  assertEqual(shared.textContent.includes("Cracked windshield"), true, "full dialogue reachable for the pinned context");
});

test("visually hidden labels are not sent to the model as question text", () => {
  const dom = createDom(`<div class="que multianswer"><div class="formulation clearfix"><div class="qtext">You can charge a car from a <span class="visually-hidden">Blank 1 Вопрос 17</span><select name="s1"><option value="">Выберите...</option><option value="1">socket</option><option value="2">plug</option></select>. Most cars use <span class="sr-only">Blank 2</span><select name="s2"><option value="">Выберите...</option><option value="1">lithium-ion</option><option value="2">lead-acid</option></select> batteries.</div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  const data = api.extractQuestionData(formulation);
  assertEqual(data.text.includes("Blank 1") || data.text.includes("Вопрос 17") || data.text.includes("Blank 2"), false, "hidden labels removed");
  assertEqual(data.text.includes("[Gap 1]") && data.text.includes("[Gap 2]"), true, "gaps still numbered");
});

test("cloze answer echoed as 'Blank N ...: word' lines fills each dropdown", () => {
  const dom = createDom(`<div class="que multianswer"><div class="formulation clearfix"><div class="qtext">You can charge a car from a <select name="s1"><option value="">Выберите...</option><option value="1">socket</option><option value="2">plug</option></select>. Most cars use <select name="s2"><option value="">Выберите...</option><option value="1">lithium-ion</option><option value="2">lead-acid</option></select> batteries.</div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  api.autoFillAnswer(formulation, "You can charge an electric car from a home Blank 1 Bonpoc 17: socket\nMost electric cars use Blank 2 Bonpoc 17: lithium-ion", "Embedded Cloze");
  const chosen = [...formulation.querySelectorAll("select")].map((select) => select.options[select.selectedIndex].text);
  assertEqual(chosen.join("|"), "socket|lithium-ion", "both gaps filled from echoed lines");
});

test("cloze answer echoed as plain sentences ending in ': word' fills gaps in order", () => {
  const dom = createDom(`<div class="que multianswer"><div class="formulation clearfix"><div class="qtext">You can charge a car from a <select name="s1"><option value="">Выберите...</option><option value="1">socket</option><option value="2">plug</option></select>. Most cars use <select name="s2"><option value="">Выберите...</option><option value="1">lithium-ion</option><option value="2">lead-acid</option></select> batteries. The motor produces <select name="s3"><option value="">Выберите...</option><option value="1">torque</option><option value="2">power</option></select> to turn the wheels.</div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  api.autoFillAnswer(formulation, "You can charge an electric car from a home: socket\nMost electric cars use batteries: lithium-ion\nThe electric motor produces to turn the wheels: torque", "Embedded Cloze");
  const chosen = [...formulation.querySelectorAll("select")].map((select) => select.options[select.selectedIndex].text);
  assertEqual(chosen.join("|"), "socket|lithium-ion|torque", "all three gaps filled from echoed sentences");
});

test("cloze answer as full sentences (no numbers, no colons) picks the option named in each sentence", () => {
  const gapOptions = [["socket", "plug", "cable"], ["lithium-ion", "lead-acid", "nickel-cadmium"], ["emissions", "fumes", "noise"], ["torque", "power", "voltage"], ["cooling", "heating", "insulation"], ["drivetrain", "gearbox", "engine"]];
  const select = (i) => `<select name="s${i}"><option value="">Выберите...</option>${gapOptions[i - 1].map((o, j) => `<option value="${j + 1}">${o}</option>`).join("")}</select>`;
  const dom = createDom(`<div class="que multianswer"><div class="formulation clearfix"><div class="qtext">You can charge an electric car from a ${select(1)}. Most electric cars use ${select(2)} batteries. Electric cars have lower ${select(3)} tailpipe than petrol cars. The electric motor produces ${select(4)} to turn the wheels. Engineers design a battery ${select(5)} system to keep cells at a safe temperature. The power flow from battery to motor is part of the car's ${select(6)}.</div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  api.autoFillAnswer(formulation, [
    "You can charge an electric car from a home socket.",
    "Most electric cars use lithium-ion batteries.",
    "Electric cars have lower tailpipe emissions than petrol cars.",
    "The electric motor produces torque to turn the wheels.",
    "Engineers design a battery cooling system to keep cells at a safe temperature.",
    "The power flow from battery to motor is part of the car's drivetrain.",
  ].join("\n"), "Embedded Cloze");
  const chosen = [...formulation.querySelectorAll("select")].map((select) => select.options[select.selectedIndex].text);
  assertEqual(chosen.join("|"), "socket|lithium-ion|emissions|torque|cooling|drivetrain", "each gap filled from its sentence");
});

test("inline gap dropdowns in one text block (no multianswer class) are not treated as Matching", () => {
  const words = ["socket", "lithium-ion", "emissions", "torque", "cooling", "drivetrain"];
  const select = (i) => `<select name="s${i}"><option value="">Выберите...</option>${words.map((w, j) => `<option value="${j + 1}">${w}</option>`).join("")}</select>`;
  const dom = createDom(`<div class="formulation clearfix"><div class="qtext">You can charge an electric car from a ${select(1)}. Most electric cars use ${select(2)} batteries. Electric cars have lower ${select(3)} tailpipe than petrol cars. The electric motor produces ${select(4)} to turn the wheels. Engineers design a battery ${select(5)} system to keep cells at a safe temperature. The power flow from battery to motor is part of the car's ${select(6)}.</div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Embedded Cloze", "question type");
  api.autoFillAnswer(formulation, [
    "You can charge an electric car from a home: socket",
    "Most electric cars use lithium-ion batteries: lithium-ion",
    "Electric cars have lower tailpipe emissions than petrol cars: emissions",
    "The electric motor produces torque to turn the wheels: torque",
    "Engineers design a battery cooling system to keep cells at a safe temperature: cooling",
    "The power flow from battery to motor is part of the car's drivetrain: drivetrain",
  ].join("\n"), "Embedded Cloze");
  const chosen = [...formulation.querySelectorAll("select")].map((select) => select.options[select.selectedIndex].text);
  assertEqual(chosen.join("|"), "socket|lithium-ion|emissions|torque|cooling|drivetrain", "each gap gets its own option");
});

test("MathJax radio options with LaTeX source are matched by formula text, not by duplicated markup", () => {
  const mathOption = (latex, visible, id) => `<input type="radio" name="q" id="${id}"><label for="${id}"><span class="MathJax_Preview"></span><span class="MathJax"><span class="math">${visible}</span></span><script type="math/tex">${latex}</script></label>`;
  const dom = createDom(`<div class="formulation"><div class="qtext">Общим решением уравнения является:</div>${mathOption("y=\\varphi(x,C_1,C_2,\\dots,C_n)", "y=φ(x,C1,C2,…,Cn)", "a")}${mathOption("\\Phi(x,y,C_1,\\dots,C_n)=0", "Φ(x,y,C1,…,Cn)=0", "b")}${mathOption("y=\\varphi(x)", "y=φ(x)", "c")}${mathOption("y=\\varphi(x,C)", "y=φ(x,C)", "d")}</div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Multiple Choice (Single)", "question type");
  api.autoFillAnswer(formulation, "y=φ(x,C1,C2,…,Cn)", "Multiple Choice (Single)");
  assertEqual(formulation.querySelector("#a").checked, true, "general solution option checked");
  assertEqual(formulation.querySelectorAll("input:checked").length, 1, "exactly one option checked");
});

test("drag words into sentence blanks (ddwtos) is its own type, not the image drag-and-drop type", () => {
  const dom = createDom(`<div class="que ddwtos"><div class="formulation clearfix"><div class="qtext">Внутри заряженности сферы <span class="drop place1 group1">&#160;</span>, поэтому <span class="drop place2 group1">&#160;</span>.</div><div class="answercontainer"><div class="draggrouphomes1"><span class="draghome choice1 group1">не содержатся</span><span class="draghome choice2 group1">E=0</span></div></div><input type="hidden" class="placeinput place1 group1" name="q1:1_p1" value="0"><input type="hidden" class="placeinput place2 group1" name="q1:1_p2" value="0"></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Drag into Text", "question type");
});

test("drag into text question gets numbered gaps, each limited to its own word group", () => {
  // Markup copied from a live Moodle ddwtos question: place1 uses group1 words, place2 uses group2 words.
  const dom = createDom(`<div class="que ddwtos"><div class="formulation clearfix"><div class="qtext"><p>Внутри заряженности сферы или замкнутой поверхности зарядов <span class="place1 drop active group1" tabindex="0">&#160;<span class="accesshide">Blank 1 Вопрос 9</span></span> , поэтому <span class="place2 drop active group2" tabindex="0">&#160;<span class="accesshide">Blank 2 Вопрос 9</span></span> .</p></div><div class="answercontainer"><div class="user-select-none draggrouphomes1"><span class="draghome user-select-none choice1 group1">не содержатся</span> <span class="draghome user-select-none choice2 group1">очень много</span> <span class="draghome user-select-none choice3 group1">очень мало</span> <span class="draghome user-select-none choice4 group1">постоянно меняется</span> </div><div class="user-select-none draggrouphomes2"><span class="draghome user-select-none choice1 group2">E=0</span> <span class="draghome user-select-none choice2 group2">E</span> <span class="draghome user-select-none choice3 group2">E>0</span> <span class="draghome user-select-none choice4 group2">E<0</span> </div></div><input type="hidden" id="q1_9_p1" class="placeinput place1 group1" name="q1:9_p1" value="0" /><input type="hidden" id="q1_9_p2" class="placeinput place2 group2" name="q1:9_p2" value="0" /></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  const data = api.extractQuestionData(formulation);
  assertEqual(data.type, "Drag into Text", "question type");
  assertEqual(data.text.includes("[Gap 1]") && data.text.includes("[Gap 2]"), true, "gaps numbered in text");
  assertEqual(data.text.includes("Blank 1"), false, "accessible blank labels removed");
  assertEqual(data.dropGroups[0].words.join("|"), "не содержатся|очень много|очень мало|постоянно меняется", "gap 1 gets only group 1 words");
  assertEqual(data.dropGroups[1].words.join("|"), "E=0|E|E>0|E<0", "gap 2 gets only group 2 words");
});

test("numeric answer options keep their leading number, labels like 'a.' or '1)' are removed", () => {
  const dom = createDom(`<div class="que multichoice"><div class="formulation clearfix"><div class="qtext">Индуктивность катушки 0,6 Гн. Скорость изменения тока?</div><div class="answer"><div class="r0"><input type="radio" name="q" id="o1"><label for="o1"><div class="flex-fill ms-1">2 А/с</div></label></div><div class="r1"><input type="radio" name="q" id="o2"><label for="o2"><div class="flex-fill ms-1">4 А/с</div></label></div><div class="r0"><input type="radio" name="q" id="o3"><label for="o3"><div class="flex-fill ms-1">a. 0,4 А/с</div></label></div><div class="r1"><input type="radio" name="q" id="o4"><label for="o4"><div class="flex-fill ms-1">2) Ф</div></label></div></div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  const data = api.extractQuestionData(formulation);
  assertEqual(data.options.join("|"), "2 А/с|4 А/с|0,4 А/с|Ф", "numeric options kept, labels stripped");
});

test("Matching answers written as 'Item: match' without spaces around the colon fill every dropdown", () => {
  const pairs = [
    ["SUV (Sport Utility Vehicle)", "внедорожник"],
    ["Sedan", "седан"],
    ["Van", "фургон"],
    ["cargo van", "грузовой фургон"],
    ["passenger van (minivan)", "минивэн"],
  ];
  const options = `<option value="">Выберите...</option>${pairs.map(([, match], i) => `<option value="${i + 1}">${match}</option>`).join("")}<option value="9">хэтчбек</option>`;
  const rows = pairs.map(([item], i) => `<tr><td>${item}</td><td><select name="s${i}">${options}</select></td></tr>`).join("");
  const dom = createDom(`<div class="que ddmatch"><div class="formulation clearfix"><table class="answer">${rows}</table></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  assertEqual(api.detectQuestionType(formulation), "Matching", "question type");
  api.autoFillAnswer(formulation, pairs.map(([item, match]) => `${item}: ${match}`).join("\n"), "Matching");
  const chosen = [...formulation.querySelectorAll("select")].map((select) => select.options[select.selectedIndex].text);
  assertEqual(chosen.join("|"), pairs.map(([, match]) => match).join("|"), "every dropdown gets its match");
});

test("Matching item text excludes dropdown options", () => {
  const options = `<option value="">Choose...</option><option value="1">двигатель</option><option value="2">колесо</option>`;
  const dom = createDom(`<div class="que match"><div class="formulation"><table class="answer"><tr><td class="text">Engine</td><td class="control"><select>${options}</select></td></tr><tr><td class="text">Wheel</td><td class="control"><select>${options}</select></td></tr></table></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".formulation");
  const data = api.extractQuestionData(formulation);
  assertEqual(data.matchingPairs[0].item, "Engine", "item contains only its own text");
  assertEqual(data.matchingPairs[0].matches.join("|"), "двигатель|колесо", "dropdown options remain available as matches");
});

test("context video is not shared with following multichoice questions", () => {
  const dom = createDom(`<div class="que description"><div class="formulation clearfix"><div class="qtext"><p>Watch the video.</p><video><source src="/pluginfile.php/clip.mp4" type="video/mp4" /></video></div></div></div><div class="que multichoice"><div class="formulation clearfix"><div class="qtext">Which statement is true?</div><div class="answer"><div class="r0"><input type="radio" name="q" id="a" /><label for="a">A</label></div><div class="r1"><input type="radio" name="q" id="b" /><label for="b">B</label></div></div></div></div>`);
  const api = dom.window.__moodleAiTest;
  const formulation = dom.window.document.querySelector(".que.multichoice .formulation");
  const shared = api.getSharedContextData(formulation).media;
  assertEqual(shared.length, 0, "context video is not inherited");
});

test("preceding description text is inherited as automatic question context", () => {
  const dom = createDom(`<div class="que description"><div class="formulation"><div class="qtext">Read this passage before answering.</div></div></div><div class="que truefalse"><div class="formulation"><div class="qtext">The statement is correct.</div><input type="radio" id="t"><label for="t">True</label><input type="radio" id="f"><label for="f">False</label></div></div>`);
  const formulation = dom.window.document.querySelector(".que.truefalse .formulation");
  const context = dom.window.__moodleAiTest.getSharedContextData(formulation);
  assertEqual(context.text, "Read this passage before answering.", "shared description text");
});

test("auto-answer never clicks a Finish attempt button even though it is named next", () => {
  const finish = createDom(`<form><input type="submit" name="next" value="Закончить попытку ..." id="mod_quiz-next-nav"></form>`);
  assertEqual(finish.window.__moodleAiTest.findNextPageButton(), null, "finish button rejected");
  const nextRu = createDom(`<form><input type="submit" name="next" value="Следующая страница"></form>`);
  assertEqual(!!nextRu.window.__moodleAiTest.findNextPageButton(), true, "Russian next button accepted");
});

test("context editor saves a transcript as text and Cancel preserves storage", async () => {
  const dom = createDom(`<div class="que"><div class="formulation"><div class="qtext">Original passage</div></div></div>`);
  const storage = {};
  dom.window.chrome.storage.local.get = async () => ({ ...storage });
  dom.window.chrome.storage.local.set = async (values) => Object.assign(storage, values);
  dom.window.chrome.storage.local.remove = async (keys) => keys.forEach((key) => delete storage[key]);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const doc = dom.window.document;
  doc.querySelector(".moodle-ai-context-edit-btn").click();
  await tick();
  assertEqual(doc.querySelector(".moodle-ai-context-text").value, "Original passage", "initial context");
  doc.querySelector(".moodle-ai-context-transcript").value = "Speaker: Sample transcript.";
  doc.querySelector(".moodle-ai-context-keep-media").checked = false;
  doc.querySelector(".moodle-ai-context-save").click();
  await tick();
  assertEqual(storage.context, "Original passage\n\nAudio / video transcript:\nSpeaker: Sample transcript.", "saved combined context");
  assertEqual(storage.contextMedia.length, 0, "text-only context");
  assertEqual(!!doc.querySelector(".moodle-ai-context-editor"), false, "editor closed");
  doc.querySelector(".moodle-ai-context-edit-btn").click();
  await tick();
  assertEqual(doc.querySelector(".moodle-ai-context-text").value, storage.context, "saved text restored");
  doc.querySelector(".moodle-ai-context-text").value = "Discard this";
  doc.querySelector(".moodle-ai-context-cancel").click();
  assertEqual(storage.context.includes("Discard this"), false, "cancel does not save");
  dom.window.close();
});

test("media download controls expose direct links without changing question type", async () => {
  const dom = createDom(`<div class="que description"><div class="formulation"><div class="qtext">Watch this clip</div><video><source src="/pluginfile.php/sample.mp4" type="video/mp4"></video></div></div>`);
  const doc = dom.window.document;
  const panel = doc.querySelector(".moodle-ai-media-downloads");
  assertEqual(!!panel, true, "download panel exists");
  assertEqual(panel.querySelector("input").value, "https://moodle.example/pluginfile.php/sample.mp4", "absolute media URL");
  let sent;
  dom.window.chrome.runtime.sendMessage = (message, callback) => { sent = message; callback({ downloadId: 1 }); };
  panel.querySelector("button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(sent.action, "downloadMedia", "download message");
  assertEqual(sent.url, panel.querySelector("input").value, "download URL");
  assertEqual(dom.window.__moodleAiTest.detectQuestionType(doc.querySelector(".formulation")), "Unknown", "UI does not add answer inputs");
  dom.window.close();
});

let failures = 0;
(async () => {
  for (const { name, callback } of tests) {
    try {
      await callback();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}: ${error.message}`);
    }
  }

  console.log(`${tests.length - failures}/${tests.length} tests passed`);
  process.exitCode = failures ? 1 : 0;
})();
