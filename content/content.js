(function () {
  const BUTTON_TEXT = "AI Answer";
  const LOADING_TEXT = "Loading...";
  const CONTEXT_BTN_TEXT = "Set Context";
  const CLEAR_CONTEXT_TEXT = "Clear Context";
  const TEXT_INPUT_SELECTOR = 'input[type="text"], input[type="number"], input:not([type])';
  const GAP_SELECTOR = `select, ${TEXT_INPUT_SELECTOR}`;

  let activeContextEl = null;

  function getSessionId() {
    return window.location.origin + window.location.pathname + window.location.search;
  }

  function parseResponse(responseText) {
    const reasoningMatch = responseText.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
    const answerMatch = responseText.match(/<answer>([\s\S]*?)<\/answer>/i);

    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";
    const answer = answerMatch ? answerMatch[1].trim() : responseText.replace(/<\/?reasoning>|<\/?answer>/gi, "").trim();

    return { reasoning, answer };
  }

  function parseFormula(formula) {
    let html = formula;

    const symbols = {
      '\\alpha': '&alpha;',
      '\\beta': '&beta;',
      '\\gamma': '&gamma;',
      '\\delta': '&delta;',
      '\\epsilon': '&epsilon;',
      '\\varepsilon': '&epsilon;',
      '\\zeta': '&zeta;',
      '\\eta': '&eta;',
      '\\theta': '&theta;',
      '\\iota': '&iota;',
      '\\kappa': '&kappa;',
      '\\lambda': '&lambda;',
      '\\mu': '&mu;',
      '\\nu': '&nu;',
      '\\xi': '&xi;',
      '\\pi': '&pi;',
      '\\rho': '&rho;',
      '\\sigma': '&sigma;',
      '\\tau': '&tau;',
      '\\upsilon': '&upsilon;',
      '\\phi': '&phi;',
      '\\varphi': '&phi;',
      '\\chi': '&chi;',
      '\\psi': '&psi;',
      '\\omega': '&omega;',
      '\\Delta': '&Delta;',
      '\\cdot': '&middot;',
      '\\times': '&times;',
      '\\le': '&le;',
      '\\leq': '&le;',
      '\\ge': '&ge;',
      '\\geq': '&ge;',
      '\\neq': '&ne;',
      '\\infty': '&infin;',
      '\\approx': '&approx;'
    };

    Object.keys(symbols).forEach(key => {
      const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      html = html.replace(new RegExp(escapedKey, 'g'), symbols[key]);
    });

    for (let i = 0; i < 2; i++) {
      html = html.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
        '<span class="latex-frac"><span class="latex-num">$1</span><span class="latex-den">$2</span></span>'
      );
    }

    html = html.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
    html = html.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>');
    html = html.replace(/_([a-zA-Z0-9&;])/g, '<sub>$1</sub>');
    html = html.replace(/\^([a-zA-Z0-9&;])/g, '<sup>$1</sup>');
    html = html.replace(/\\text\s*\{([^}]+)\}/g, '$1');
    html = html.replace(/\\/g, '');

    return html;
  }

  function renderLatexToHtml(text) {
    let html = text.replace(/\$([\s\S]+?)\$/g, (match, formula) => {
      return `<span class="moodle-ai-formula">${parseFormula(formula)}</span>`;
    });
    return html;
  }

  function cleanOptionText(text) {
    return String(text || "")
      .replace(/\(Вы ответили\)|\(Answer saved\)|\(Saved\)/gi, "")
      // Strip only real option labels such as "a.", "a)", "1)", "2." and never a bare number that is the answer itself ("2 А/с").
      .replace(/^(?:[a-zа-яё]|\d+)[\.\)]\s*|^[a-zа-яё]\s+-\s+/i, "")
      .replace(/[\s\xa0]+/g, " ")
      .trim();
  }

  function cleanTextForMatching(text) {
    return cleanOptionText(text)
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getAccessibleText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll("img").forEach((img) => {
      const description = img.getAttribute("alt") || img.getAttribute("title") || "";
      img.replaceWith(clone.ownerDocument.createTextNode(description ? ` ${description} ` : " "));
    });
    clone.querySelectorAll("audio, video").forEach((media) => {
      const description = media.getAttribute("aria-label") || media.getAttribute("title") || "media attachment";
      media.replaceWith(clone.ownerDocument.createTextNode(` [${description}] `));
    });
    // Remove media player chrome (MediaElement/mejs settings, controls, time labels) and hidden labels.
    // MathJax keeps its LaTeX source in <script type="math/tex">; it is not visible text and must not reach matching.
    clone.querySelectorAll("script, style, select, button, .moodle-ai-btn-wrapper, .moodle-ai-answer, .accesshide, .visually-hidden, .sr-only, .mejs__container, .mejs-container, [class*='mejs'], [class*='mediaplugin'], [class*='mejs']").forEach((el) => el.remove());
    return (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getElementTextWithoutSelects(element) {
    return getAccessibleText(element);
  }

  function getInputLabelText(input, formulation) {
    if (input.id) {
      const label = formulation.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      const labelText = getAccessibleText(label);
      if (labelText) return labelText;
    }

    const parentLabel = input.closest("label");
    const parentLabelText = getAccessibleText(parentLabel);
    if (parentLabelText) return parentLabelText;

    const ariaLabel = input.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();

    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => getAccessibleText(document.getElementById(id))).filter(Boolean).join(" ");
      if (text) return text;
    }

    let sibling = input.nextElementSibling;
    while (sibling) {
      if (sibling.tagName === "LABEL" || sibling.className.includes("label") || sibling.className.includes("text")) {
        const siblingText = getAccessibleText(sibling);
        if (siblingText) return siblingText;
      }
      sibling = sibling.nextElementSibling;
    }

    const container = input.closest(".r0, .r1, .option, .answer, [class*='option'], [class*='choice']");
    if (container) {
      const clone = container.cloneNode(true);
      clone.querySelectorAll("input, select").forEach((el) => el.remove());
      return getAccessibleText(clone);
    }

    return "";
  }

  function setInputChecked(input, checked, formulation) {
    if (input.checked === checked || input.disabled) return;

    if (input.id) {
      const label = formulation.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) label.click();
    } else {
      const parentLabel = input.closest("label");
      if (parentLabel) parentLabel.click();
      else input.click();
    }

    if (input.checked !== checked) {
      input.checked = checked;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function setControlValue(control, value) {
    if (!control || control.disabled) return;
    const prototype = control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(control, value);
    else control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getMathText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll('[data-tex]').forEach((node) => {
      node.replaceWith(clone.ownerDocument.createTextNode(` ${node.getAttribute("data-tex") || ""} `));
    });
    clone.querySelectorAll('script[type^="math/tex"]').forEach((node) => {
      node.replaceWith(clone.ownerDocument.createTextNode(` ${node.textContent || ""} `));
    });
    clone.querySelectorAll('annotation[encoding*="tex"]').forEach((node) => {
      node.replaceWith(clone.ownerDocument.createTextNode(` ${node.textContent || ""} `));
    });
    return getAccessibleText(clone);
  }

  function inferMediaType(url, mimeType = "") {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("video/")) return "video";
    const pathname = (() => { try { return new URL(url, location.href).pathname; } catch (_) { return url; } })().toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(pathname)) return "image";
    if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(pathname)) return "audio";
    if (/\.(mp4|m4v|webm|mov|avi|mkv|ogv)$/i.test(pathname)) return "video";
    return null;
  }

  function extractMediaFromElement(element) {
    const media = [];
    const seen = new Set();
    const add = (type, rawUrl, mimeType = "", label = "") => {
      if (!rawUrl) return;
      let url;
      try { url = new URL(rawUrl, location.href).href; } catch (_) { return; }
      const resolvedType = type || inferMediaType(url, mimeType);
      if (!resolvedType || seen.has(`${resolvedType}:${url}`)) return;
      seen.add(`${resolvedType}:${url}`);
      media.push({ type: resolvedType, url, mimeType, label: cleanOptionText(label), pageOrigin: location.origin });
    };

    element.querySelectorAll("img").forEach((img) => {
      if (img.closest(".moodle-ai-btn-wrapper, .moodle-ai-answer")) return;
      const width = img.naturalWidth || Number(img.getAttribute("width")) || 0;
      const height = img.naturalHeight || Number(img.getAttribute("height")) || 0;
      const decorative = img.getAttribute("role") === "presentation" || img.getAttribute("aria-hidden") === "true";
      if (decorative || (width > 0 && height > 0 && width <= 24 && height <= 24)) return;
      add("image", img.currentSrc || img.src, img.getAttribute("type") || "", img.alt || img.title || "");
    });

    element.querySelectorAll("audio, video").forEach((node) => {
      const type = node.tagName.toLowerCase();
      add(type, node.currentSrc || node.src, node.getAttribute("type") || "", node.getAttribute("aria-label") || node.title || "");
      node.querySelectorAll("source").forEach((source) => add(type, source.src, source.type || "", node.getAttribute("aria-label") || node.title || ""));
    });

    element.querySelectorAll("a[href]").forEach((link) => {
      const type = inferMediaType(link.href, link.type || "");
      if (type) add(type, link.href, link.type || "", getAccessibleText(link));
    });

    return media;
  }

  async function loadContext() {
    const { context, contextUrl, contextMedia, contextImageUrls } = await chrome.storage.local.get(["context", "contextUrl", "contextMedia", "contextImageUrls"]);
    const currentUrl = window.location.origin + window.location.pathname;
    if (contextUrl !== currentUrl) {
      await chrome.storage.local.remove(["context", "contextUrl", "contextMedia", "contextImageUrls"]);
      return { text: null, media: [] };
    }
    const legacyMedia = (contextImageUrls || []).map((url) => ({ type: "image", url }));
    return { text: context || null, media: contextMedia || legacyMedia };
  }

  async function setContext(text, element, media = []) {
    const currentUrl = window.location.origin + window.location.pathname;

    await chrome.storage.local.set({
      context: text,
      contextUrl: currentUrl,
      contextMedia: media
    });
    activeContextEl = element;
    element.classList.add("moodle-ai-context-active");
    updateContextButtons();
    updateGlobalContextIndicator();
  }

  async function clearContext() {
    await chrome.storage.local.remove(["context", "contextUrl", "contextMedia", "contextImageUrls"]);
    if (activeContextEl) {
      activeContextEl.classList.remove("moodle-ai-context-active");
      activeContextEl = null;
    }
    updateContextButtons();
    updateGlobalContextIndicator();
  }

  function updateContextButtons() {
    document.querySelectorAll(".moodle-ai-context-btn").forEach((btn) => {
      const formulation = btn.closest(".formulation, .que, [class*='question'], .formulation.clearfix");
      const isActive = formulation === activeContextEl;
      btn.textContent = isActive ? CLEAR_CONTEXT_TEXT : CONTEXT_BTN_TEXT;
      btn.classList.toggle("moodle-ai-context-btn-active", isActive);
    });
  }

  function detectQuestionType(formulation) {
    const radios = [...formulation.querySelectorAll('input[type="radio"]')].filter((input) => !input.disabled);
    const checkboxes = [...formulation.querySelectorAll('input[type="checkbox"]')].filter((input) => !input.disabled);
    const textInputs = formulation.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
    const hasTextarea = !!formulation.querySelector("textarea, [contenteditable='true']");
    const selects = [...formulation.querySelectorAll("select")].filter((select) => !select.disabled);
    const classText = `${formulation.className} ${formulation.closest(".que")?.className || ""}`.toLowerCase();

    const radioLabels = radios.map((input) => cleanTextForMatching(getInputLabelText(input, formulation)));
    const trueWords = /^(true|yes|да|верно|правильно)$/u;
    const falseWords = /^(false|no|нет|неверно|неправильно)$/u;
    const isTrueFalse = /truefalse/.test(classText)
      || (radioLabels.length === 2 && radioLabels.some((text) => trueWords.test(text)) && radioLabels.some((text) => falseWords.test(text)));

    if (isTrueFalse) return "True/False";
    if (checkboxes.length > 0) return "Multiple Choice (Multiple)";
    if (radios.length > 0) return "Multiple Choice (Single)";

    if (/multianswer/.test(classText) && selects.length + textInputs.length > 1) return "Embedded Cloze";

    // Words dragged into sentence blanks (ddwtos) also use .draghome, so they are checked first.
    if (/ddwtos/.test(classText) || formulation.querySelector(".drop.place1, .drop[class*='place'], .answercontainer")) {
      return "Drag into Text";
    }

    if (formulation.querySelector(".ddarea, .draghome, input.placeinput") || /ddimageortext|ddmarker/.test(classText)) {
      return "Drag and Drop (Image)";
    }

    if (selects.length > 1) {
      const allNumeric = selects.every((select) => [...select.options].filter((option) => option.value).some((option) => /^\d+$/.test(option.text.trim())));
      const orderingClass = /(ordering|order|sequence|sort|rank)/.test(classText);
      if (/multianswer/.test(classText)) return "Embedded Cloze";
      if (allNumeric || orderingClass) return "Ordering";
      // Gaps inside running text: each inline select has its own word list (not item->match pairs).
      const isInlineGap = selects.every((select) => select.closest(".subquestion"));
      const wordOptions = selects.every((select) => {
        const values = [...select.options].filter((option) => option.value);
        return values.length >= 2 && values.every((option) => option.text.trim().length > 0);
      });
      if (isInlineGap && wordOptions) return "Embedded Cloze";
      // Matching puts each dropdown in its own row. Several dropdowns sharing one row container are gaps in running text.
      const rowContainers = new Set(selects.map((select) => select.closest("tr, div, li")));
      if (rowContainers.size < selects.length) return "Embedded Cloze";
      return "Matching";
    }

    if (selects.length === 1) return /multianswer/.test(classText) ? "Embedded Cloze" : "Dropdown";
    if (hasTextarea) return "Essay";
    if (textInputs.length > 0) return "Short Answer";
    return "Unknown";
  }

  // Content scripts run in an isolated world, so Moodle's listeners (on the page's own world) must be
  // triggered from injected page code. The payload is passed as JSON in a data attribute.
  function setInputValueNative(input, value) {
    input.setAttribute("value", value);
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fireMouse(target, type, x, y) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
    }));
  }

  // Performs the same mouse sequence as a user dragging a label onto a numbered place.
  // Returns true only if Moodle reports the label as placed in that place.
  async function simulateDragToDrop(dragEl, dropEl) {
    const from = dragEl.getBoundingClientRect();
    const to = dropEl.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return false;

    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;
    const endX = to.left + to.width / 2;
    const endY = to.top + to.height / 2;

    fireMouse(dragEl, "mousedown", startX, startY);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      fireMouse(document, "mousemove", x, y);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // A real mouseup is delivered to the element under the pointer, which is the target drop zone.
    fireMouse(dropEl, "mouseup", endX, endY);

    // Moodle animates the drag into place; wait for the class change before checking.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const placeClass = `inplace${dropEl.className.match(/place(\d+)/)?.[1]}`;
    return dragEl.classList.contains("placed") && dragEl.classList.contains(placeClass);
  }

  function getClozeGaps(formulation) {
    // Dropdowns and text blanks in document order, so gap numbers match what the model sees.
    return [...formulation.querySelectorAll(GAP_SELECTOR)];
  }

  function extractQuestionData(formulation) {
    const questionTextEl = formulation.querySelector(".qtext, .questiontext, [class*='question-text']");
    const textSource = questionTextEl || formulation;
    const clone = textSource.cloneNode(true);
    // Text blanks inside running text ("(1) ___") are gaps, not separate inputs.
    const isCloze = detectQuestionType(formulation) === "Embedded Cloze"
      || (formulation.querySelectorAll(TEXT_INPUT_SELECTOR).length > 1 && /\(\d+\)\s*_+/.test(textSource.textContent || ""));
    if (detectQuestionType(formulation) === "Drag into Text") {
      // Word-bank blanks are <span class="drop placeN">; number them so the answer can name them.
      clone.querySelectorAll(".drop").forEach((drop) => {
        const place = (drop.className.match(/place(\d+)/) || [])[1];
        drop.replaceWith(clone.ownerDocument.createTextNode(` [Gap ${place || "?"}] `));
      });
    } else if (isCloze) {
      clone.querySelectorAll(".accesshide").forEach((el) => el.remove());
      clone.querySelectorAll(GAP_SELECTOR).forEach((control, index) => {
        control.replaceWith(clone.ownerDocument.createTextNode(` [Gap ${index + 1}] `));
      });
    } else {
      clone.querySelectorAll(TEXT_INPUT_SELECTOR).forEach((input, index) => {
        input.replaceWith(clone.ownerDocument.createTextNode(`[Input ${index + 1}]`));
      });
    }
    let questionText = getAccessibleText(clone);
    const media = extractMediaFromElement(formulation);

    questionText = questionText
      .replace(/\s+/g, ' ')
      .replace(/\(Вы ответили\)|\(Answer saved\)|\(Saved\)/gi, '')
      .trim();

    const type = detectQuestionType(formulation);
    const data = { type, text: questionText, media };

    if (type.includes("Multiple Choice") || type === "True/False") {
      const options = [];
      const seenTexts = new Set();

      const addOption = (text) => {
        const cleanText = cleanOptionText(text);
        if (cleanText && !seenTexts.has(cleanText)) {
          seenTexts.add(cleanText);
          options.push(cleanText);
        }
      };

      const inputs = formulation.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      inputs.forEach((input) => {
        const labelText = getInputLabelText(input, formulation);
        if (labelText) {
          addOption(labelText);
        }
      });

      data.options = options;
      console.log("[Moodle AI] Extracted options:", options);
    }

    if (type === "Dropdown") {
      const select = formulation.querySelector("select");
      data.options = [...select.options].filter((option) => option.value).map((option) => cleanOptionText(option.text));
    }

    if (type === "Drag into Text") {
      // Moodle splits words into groups: a gap accepts only the words of its own group (group1, group2, ...).
      const wordsByGroup = new Map();
      formulation.querySelectorAll(".draghome:not(.dragplaceholder)").forEach((el) => {
        const group = (el.className.match(/group(\d+)/) || [])[1];
        const text = cleanOptionText(el.textContent);
        if (!group || !text) return;
        if (!wordsByGroup.has(group)) wordsByGroup.set(group, []);
        const words = wordsByGroup.get(group);
        if (!words.includes(text)) words.push(text);
      });
      const drops = [...formulation.querySelectorAll(".drop")];
      data.dropGroups = drops.map((drop) => {
        const place = Number((drop.className.match(/place(\d+)/) || [])[1]);
        const group = (drop.className.match(/group(\d+)/) || [])[1];
        return { place, group, words: wordsByGroup.get(group) || [] };
      }).filter((gap) => gap.place);
      data.dropPlaces = data.dropGroups.map((gap) => gap.place);
      data.dragItems = [...new Set([...wordsByGroup.values()].flat())];
    }

    if (type === "Drag and Drop (Image)") {
      data.dragItems = [...formulation.querySelectorAll(".draghome")].map((el) => cleanOptionText(el.textContent)).filter(Boolean);
      data.dropPlaces = [...formulation.querySelectorAll("input.placeinput")].map((input) => {
        const place = (input.className.match(/place(\d+)/) || [])[1];
        return place ? Number(place) : null;
      }).filter(Boolean).sort((a, b) => a - b);
    }

    if (type === "Matching") {
      const selects = formulation.querySelectorAll("select");
      const pairs = [];
      selects.forEach((select) => {
        const row = select.closest("tr, div, li");
        if (row) {
          const itemText = getMathText(row);
          const matches = [];
          select.querySelectorAll("option").forEach((opt) => {
            if (opt.value) matches.push(cleanOptionText(opt.text));
          });
          if (itemText) {
            pairs.push({ item: itemText, matches });
          }
        }
      });
      data.matchingPairs = pairs;
    }

    if (type === "Embedded Cloze") {
      const gaps = getClozeGaps(formulation);
      data.gapCount = gaps.length;
      // null marks a free-text gap; an array lists the dropdown options.
      data.gapOptions = gaps.map((control) => control.tagName === "SELECT"
        ? [...control.options].filter((option) => option.value).map((option) => cleanOptionText(option.text))
        : null);
    }

    if (type === "Ordering") {
      const items = [];
      const selects = formulation.querySelectorAll("select");
      selects.forEach((select) => {
        const row = select.closest("tr, div, li, .answer, .flex-fill, .col-md-9, [class*='answer']");
        if (!row) return;

        const statementText = getMathText(row);
        if (statementText && statementText.length > 1) {
          items.push({ text: statementText });
        }
      });

      data.orderingItems = items;
      console.log("[Moodle AI] Extracted ordering items:", items.map(i => i.text.substring(0, 50)));
    }

    return data;
  }

  // Returns the option whose text appears as whole words in the sentence (the longest such option wins), or null.
  function findOptionInSentence(options, sentence) {
    const paddedSentence = ` ${cleanTextForMatching(sentence)} `;
    let best = null;
    let bestLength = 0;
    options.forEach((option) => {
      const normalized = cleanTextForMatching(option.text);
      if (normalized && paddedSentence.includes(` ${normalized} `) && normalized.length > bestLength) {
        best = option;
        bestLength = normalized.length;
      }
    });
    return best;
  }

  function calculateSimilarity(str1, str2) {
    const normalized1 = cleanTextForMatching(str1);
    const normalized2 = cleanTextForMatching(str2);
    if (!normalized1 || !normalized2) return 0;
    if (normalized1 === normalized2) return 1;

    const words1 = normalized1.split(" ").filter(Boolean);
    const words2 = normalized2.split(" ").filter(Boolean);
    const intersection = words1.filter((word) => words2.includes(word)).length;
    const wordScore = intersection / Math.max(words1.length, words2.length);
    const containmentScore = normalized1.includes(normalized2) || normalized2.includes(normalized1) ? 0.8 : 0;
    return Math.max(wordScore, containmentScore);
  }

  function findBestTextMatch(items, target, getText = (item) => item) {
    const scored = items.map((item) => ({ item, score: calculateSimilarity(getText(item), target) }))
      .sort((a, b) => b.score - a.score);
    if (!scored[0] || scored[0].score < 0.72) return null;
    if (scored[1] && scored[0].score < 1 && scored[0].score - scored[1].score < 0.12) return null;
    return scored[0].item;
  }

  async function autoFillAnswer(formulation, answer, questionType) {
    const normalizedAnswer = cleanTextForMatching(answer);

    if (questionType === "True/False") {
      const isTrue = /^(true|yes|да|верно|правильно)$/u.test(normalizedAnswer);
      const isFalse = /^(false|no|нет|неверно|неправильно)$/u.test(normalizedAnswer);
      if (!isTrue && !isFalse) return;
      const inputs = [...formulation.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
      const target = inputs.find((input) => {
        const label = cleanTextForMatching(getInputLabelText(input, formulation));
        return isTrue ? /^(true|yes|да|верно|правильно)$/u.test(label) : /^(false|no|нет|неверно|неправильно)$/u.test(label);
      });
      if (target) setInputChecked(target, true, formulation);
      return;
    }

    if (questionType.includes("Multiple Choice")) {
      const isMultiple = questionType === "Multiple Choice (Multiple)";
      const inputs = [...formulation.querySelectorAll(isMultiple ? 'input[type="checkbox"]' : 'input[type="radio"]')];
      if (isMultiple) {
        const answerLines = answer.split(/\n/).map(cleanTextForMatching).filter(Boolean);
        const targetInputs = new Set();
        answerLines.forEach((line) => {
          const target = findBestTextMatch(inputs, line, (input) => getInputLabelText(input, formulation));
          if (target) targetInputs.add(target);
        });
        if (targetInputs.size !== answerLines.length) return;
        inputs.forEach((input) => setInputChecked(input, targetInputs.has(input), formulation));
      } else {
        const target = findBestTextMatch(inputs, answer, (input) => getInputLabelText(input, formulation));
        if (target) setInputChecked(target, true, formulation);
      }
      return;
    }

    if (questionType === "Embedded Cloze") {
      const gaps = getClozeGaps(formulation);
      const values = new Map();
      const answerLines = answer.split(/\n/).map((line) => line.trim()).filter(Boolean);
      answerLines.forEach((line) => {
        // Accepts "1: word" and "... Blank 1 ...: word", which the model sometimes echoes from the question.
        const numbered = line.match(/^(\d+)\s*[:.)-]\s*(.+)$/);
        const labelled = line.match(/\b(?:blank|gap)\s*(\d+)\b[^:]*:\s*(.+)$/i);
        const match = numbered || labelled;
        if (match) values.set(Number(match[1]), match[2].trim());
      });
      // Fallback: the model echoed each sentence with the gap filled, e.g. "The motor produces torque" is
      // "...: torque". Without numbers, the n-th line with a colon fills the n-th gap.
      if (values.size === 0) {
        let gapNumber = 0;
        answerLines.forEach((line) => {
          const colon = line.lastIndexOf(":");
          if (colon <= 0) return;
          gapNumber += 1;
          values.set(gapNumber, line.slice(colon + 1).trim());
        });
      }
      const usedLines = new Set();
      gaps.forEach((control, index) => {
        let word = values.get(index + 1);
        if (!word && control.tagName === "SELECT") {
          // The model wrote full sentences instead of "N: word". Line N belongs to gap N when the counts match;
          // otherwise use the first unused line that names one of this gap's options.
          const options = [...control.options].filter((option) => option.value);
          const candidateLines = answerLines.length === gaps.length
            ? [index]
            : answerLines.map((_, i) => i).filter((i) => !usedLines.has(i));
          for (const i of candidateLines) {
            const option = findOptionInSentence(options, answerLines[i]);
            if (option) {
              word = option.text;
              usedLines.add(i);
              break;
            }
          }
        }
        if (!word) return;
        if (control.tagName === "SELECT") {
          const options = [...control.options].filter((option) => option.value);
          const target = findBestTextMatch(options, word, (option) => option.text);
          if (target) setControlValue(control, target.value);
        } else {
          setControlValue(control, word);
        }
      });
      return;
    }

    if (questionType === "Dropdown") {
      const select = formulation.querySelector("select");
      const options = [...select.options].filter((option) => option.value);
      const target = findBestTextMatch(options, answer, (option) => option.text);
      if (target) setControlValue(select, target.value);
      return;
    }

    if (questionType === "Short Answer" || questionType === "Essay") {
      const textarea = formulation.querySelector("textarea");
      const contentEditable = formulation.querySelector("[contenteditable='true']");
      if (contentEditable) {
        contentEditable.textContent = answer.trim();
        contentEditable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: answer.trim() }));
      }
      if (textarea) setControlValue(textarea, answer.trim());
      if (!textarea && !contentEditable) {
        const textInputs = [...formulation.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')];
        const answerLines = answer.split("\n").map((line) => line.trim()).filter(Boolean);

        // One shared passage with several numbered blanks is split into one question per blank.
        // Each question's own blank number is its position among the blank questions on the page.
        const blankQuestions = [...document.querySelectorAll(".que.shortanswer")];
        const questionIndex = blankQuestions.indexOf(formulation.closest(".que"));
        const blankNumber = questionIndex >= 0 ? String(questionIndex + 1) : null;
        const numberedLine = blankNumber
          ? answerLines.find((line) => new RegExp(`^${blankNumber}\\s*[:.)-]\\s*`).test(line))
          : null;

        if (textInputs.length === 1 && numberedLine) {
          setControlValue(textInputs[0], numberedLine.replace(/^\d+\s*[:.)-]\s*/, "").trim());
        } else {
          textInputs.forEach((input, index) => {
            if (index < answerLines.length) setControlValue(input, answerLines[index]);
          });
        }
      }
      return;
    }

    if (questionType === "Drag and Drop (Image)") {
      // Answers are lines "N: label" where N is the number printed on the image.
      // Moodle only reads the hidden inputs on page load, so each label is dragged onto its place.
      const pairs = answer.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const match = line.match(/^(\d+)\s*[:.)-]\s*(.+)$/);
        return match ? { place: Number(match[1]), label: match[2].trim() } : null;
      }).filter(Boolean);

      // EXPERIMENTAL: Moodle reads "placeinput" values on page load, and a window resize did NOT
      // re-place drags in a live test. Drags may stay in their home positions after this runs.
      console.warn("[Moodle AI] Drag and Drop placement is experimental and may not show on the image.");
      const homes = [...formulation.querySelectorAll(".draghome:not(.dragplaceholder)")];
      const choiceByLabel = new Map();
      homes.forEach((el) => {
        const choice = (el.className.match(/choice(\d+)/) || [])[1];
        if (choice) choiceByLabel.set(el.textContent.trim(), choice);
      });

      for (const { place, label } of pairs) {
        const exact = [...choiceByLabel.keys()].find((text) => cleanTextForMatching(text) === cleanTextForMatching(label));
        const best = exact || [...choiceByLabel.keys()]
          .map((text) => ({ text, score: calculateSimilarity(text, label) }))
          .sort((a, b) => b.score - a.score)[0];
        const choice = exact ? choiceByLabel.get(exact) : (best && best.score >= 0.72 ? choiceByLabel.get(best.text) : null);
        const input = formulation.querySelector(`input.placeinput.place${place}`);
        if (!choice || !input) {
          console.warn(`[Moodle AI] No match for "${label}" on place ${place}`);
          continue;
        }
        setInputValueNative(input, choice);
      }

      // Moodle re-positions every drag from the inputs on window resize.
      window.dispatchEvent(new Event("resize"));
      return;
    }

    if (questionType === "Matching") {
      const answerPairs = answer.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        // Separators are tried in order of specificity. A colon or arrow may have no spaces around it
        // ("Sedan: седан"), while a plain hyphen must have spaces so "four-wheel drive" is not split.
        const separator = line.match(/\s*(?:->|=>|—)\s*/) || line.match(/\s*:\s*/) || line.match(/\s+-\s+/);
        if (!separator || separator.index === 0) return null;
        return { item: line.slice(0, separator.index).trim(), match: line.slice(separator.index + separator[0].length).trim() };
      }).filter((pair) => pair && pair.item && pair.match);

      formulation.querySelectorAll("select").forEach((select) => {
        const row = select.closest("tr, div, li");
        if (!row) return;
        const bestPair = findBestTextMatch(answerPairs, getMathText(row), (pair) => pair.item);
        if (!bestPair) return;
        const options = [...select.options].filter((option) => option.value);
        const bestOption = findBestTextMatch(options, bestPair.match, (option) => option.text);
        if (bestOption) setControlValue(select, bestOption.value);
      });
      return;
    }

    if (questionType === "Ordering") {
      const answerLines = answer
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const orderedItems = [];
      let foundFirstNumbered = false;

      answerLines.forEach((line) => {
        const match = line.match(/^(\d+)[\.\):\s-]+(.+)$/);
        if (match) {
          foundFirstNumbered = true;
          orderedItems.push({ position: parseInt(match[1]), text: cleanOptionText(match[2]) });
        } else if (!foundFirstNumbered) {
          // Skip introductory text
        }
      });

      if (orderedItems.length === 0) {
        answerLines.forEach((line, index) => {
          if (line && !line.toLowerCase().includes("statement") && !line.toLowerCase().includes("based on")) {
            orderedItems.push({ position: index + 1, text: cleanOptionText(line) });
          }
        });
      }

      const selects = formulation.querySelectorAll("select");

      selects.forEach((select) => {
        const row = select.closest("tr, div, li, .answer, .flex-fill, .col-md-9");
        if (!row) return;

        const rowTextClean = cleanTextForMatching(getMathText(row));
        const matchedItem = findBestTextMatch(orderedItems, rowTextClean, (item) => item.text);
        const targetPosition = matchedItem?.position || null;

        if (targetPosition) {
          const options = select.querySelectorAll("option");
          let matched = false;

          for (const option of options) {
            const optText = option.text.trim();
            const optValue = option.value.trim();

            if (optText === String(targetPosition) || optValue === String(targetPosition)) {
              setControlValue(select, option.value);
              matched = true;
              break;
            }
          }

          if (!matched && options.length > 0) {
            const positionNum = parseInt(targetPosition);
            if (positionNum > 0 && positionNum <= options.length) {
              const option = options[positionNum - 1];
              if (option && option.value) {
                setControlValue(select, option.value);
              }
            }
          }
        }
      });
      return;
    }
  }

  function createButtons() {
    const wrapper = document.createElement("div");
    wrapper.className = "moodle-ai-btn-wrapper";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "moodle-ai-btn";
    btn.textContent = BUTTON_TEXT;
    btn.addEventListener("click", handleAnswerClick);

    const contextBtn = document.createElement("button");
    contextBtn.type = "button";
    contextBtn.className = "moodle-ai-btn moodle-ai-context-btn";
    contextBtn.textContent = CONTEXT_BTN_TEXT;
    contextBtn.addEventListener("click", handleContextClick);

    const contextIndicator = document.createElement("span");
    contextIndicator.className = "moodle-ai-context-indicator";
    contextIndicator.style.display = "none";

    wrapper.appendChild(btn);
    wrapper.appendChild(contextBtn);
    wrapper.appendChild(contextIndicator);

    return { wrapper, btn, contextBtn, contextIndicator };
  }

  async function handleContextClick(e) {
    const btn = e.target;
    const formulation = btn.closest(".formulation, .que, [class*='question'], .formulation.clearfix");
    if (!formulation) return;

    const isCurrentlyActive = formulation === activeContextEl;

    if (isCurrentlyActive) {
      await clearContext();
    } else {
      // A shared passage (dialogue, listening script) is usually in an earlier "description" block,
      // so pin that block's full text instead of only this question's own short text.
      const sharedBlock = findSharedDescription(formulation);
      const source = sharedBlock || formulation;
      const questionTextEl = source.querySelector(".qtext, .questiontext, [class*='question-text']");
      const contextText = questionTextEl ? questionTextEl.innerText.trim() : source.innerText.trim();

      const media = [...extractMediaFromElement(source)];
      if (sharedBlock) {
        media.push(...extractMediaFromElement(formulation).filter((m) => !media.some((x) => x.url === m.url)));
      }

      await setContext(contextText, formulation, media);
    }
  }

  async function handleAnswerClick(e) {
    const btn = e.target;
    const formulation = btn.closest(".formulation, .que, [class*='question'], .formulation.clearfix");

    if (!formulation) return;

    await answerFormulation(formulation, btn);
  }

  // Returns the nearest preceding "description" block of the same quiz form, or null.
  function findSharedDescription(formulation) {
    const que = formulation.closest(".que");
    if (!que) return null;
    let previous = que.previousElementSibling;
    while (previous) {
      if (previous.classList.contains("description")) {
        const descriptionBody = previous.querySelector(".formulation, .content") || previous;
        return descriptionBody;
      }
      previous = previous.previousElementSibling;
    }
    return null;
  }

  // Shared listening/video material sits in an earlier "description" block of the same quiz form.
  // Both audio and video must reach the model, so any playable media counts as shared.
  function findSharedMedia(formulation) {
    const que = formulation.closest(".que");
    if (!que) return null;
    let previous = que.previousElementSibling;
    while (previous) {
      if (previous.classList.contains("que")) {
        const shared = extractMediaFromElement(previous).filter((m) => m.type === "audio" || m.type === "video");
        if (shared.length > 0) return shared;
      }
      previous = previous.previousElementSibling;
    }
    return null;
  }

  async function answerFormulation(formulation, btn, options = {}) {
    btn.textContent = LOADING_TEXT;
    btn.disabled = true;

    const questionData = extractQuestionData(formulation);
    // Pinned context (set with "Set Context") goes with every question on the page.
    // Otherwise each question uses only its own text and media.
    const pinned = await loadContext();
    const contextData = pinned.text
      ? pinned
      : { text: null, media: [] };
    // Shared audio or video often sits in an earlier "description" block of the same quiz form,
    // so questions without their own playable media inherit it from the nearest preceding block that has one.
    if (!questionData.media.some((m) => m.type === "audio" || m.type === "video")) {
      const sharedMedia = findSharedMedia(formulation);
      if (sharedMedia) questionData.media.push(...sharedMedia);
    }
    const sessionId = getSessionId();

    let answerDiv = formulation.querySelector(".moodle-ai-answer");
    if (!answerDiv) {
      answerDiv = document.createElement("div");
      answerDiv.className = "moodle-ai-answer";
      formulation.appendChild(answerDiv);
    }

    const contextStatusText = contextData.text ? " (Context active)" : "";

    answerDiv.className = "moodle-ai-answer moodle-ai-answer-loading";
    answerDiv.textContent = `Asking AI...${contextStatusText}`;

    try {
      const response = await safeSendMessage({
        action: "getAnswer",
        question: questionData,
        questionMedia: questionData.media,
        context: contextData.text,
        contextMedia: contextData.media,
        sessionId,
      });

      if (response.error) {
        answerDiv.className = "moodle-ai-answer moodle-ai-answer-error";
        answerDiv.textContent = response.error;
      } else {
        const contextStatus = contextData.text
          ? `<span class="moodle-ai-context-status" title="${escapeHtml(contextData.text.substring(0, 200)).replace(/"/g, "&quot;")}"> Context active</span>`
          : `<span class="moodle-ai-context-status moodle-ai-context-status-none">No context</span>`;

        const mediaCounts = response.loadedQuestionMediaCounts || {};
        const qImageStatus = Object.entries(mediaCounts).map(([type, count]) => {
          const icon = type === "image" ? "🖼️" : type === "audio" ? "🔊" : "🎬";
          return `<span class="moodle-ai-context-status">${icon} ${count} ${escapeHtml(type)}</span>`;
        }).join("");

        const parsed = parseResponse(response.answer);
        const safeAnswer = escapeHtml(parsed.answer).replace(/\n/g, "<br>");
        let bodyHtml = `<div class="moodle-ai-answer-text" style="font-weight: 600; font-size: 1.1em;">${safeAnswer}</div>`;
        if (parsed.reasoning) {
          const formattedReasoning = renderLatexToHtml(escapeHtml(parsed.reasoning));
          bodyHtml += `
            <details class="moodle-ai-reasoning-details" style="margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.1); padding-top: 8px; font-size: 0.9em; color: #555;">
              <summary style="cursor: pointer; font-weight: 500; outline: none; margin-bottom: 5px; color: #2e7d32;">Show Solution / Решение</summary>
              <div class="moodle-ai-reasoning-body" style="background: rgba(0,0,0,0.02); padding: 8px; border-radius: 4px; white-space: pre-wrap; font-family: sans-serif; line-height: 1.4;">${formattedReasoning}</div>
            </details>
          `;
        }

        answerDiv.className = "moodle-ai-answer moodle-ai-answer-success";
        answerDiv.innerHTML = `
          <div class="moodle-ai-answer-header">
            <strong>AI Answer:</strong>
            <div class="moodle-ai-context-indicators">
              ${contextStatus}
              ${qImageStatus}
              <button type="button" class="moodle-ai-view-log-btn" title="View full prompt and response">View Log</button>
            </div>
          </div>
          <div class="moodle-ai-answer-body">${bodyHtml}</div>
        `;

        const viewLogBtn = answerDiv.querySelector(".moodle-ai-view-log-btn");
        if (viewLogBtn) {
          viewLogBtn.addEventListener("click", () => showLogModal(response.prompt, response.answer));
        }

        const { autofill } = await chrome.storage.sync.get(["autofill"]);
        if (questionData.type !== "Drag and Drop (Image)" && (options.forceAutofill || autofill !== false)) {
          await autoFillAnswer(formulation, parsed.answer, questionData.type);
        }

        updateHistoryBadge(response.historyCount);
      }
    } catch (err) {
      if (err.message === "Extension context invalidated") {
        answerDiv.className = "moodle-ai-answer moodle-ai-answer-error";
        answerDiv.textContent = "Extension reloaded. Please refresh the page.";
      } else {
        answerDiv.className = "moodle-ai-answer moodle-ai-answer-error";
        answerDiv.textContent = `Error: ${err.message}`;
      }
    }

    btn.textContent = BUTTON_TEXT;
    btn.disabled = false;
    return answerDiv.classList.contains("moodle-ai-answer-success");
  }

  function createHistoryBadge(count) {
    const badge = document.createElement("span");
    badge.className = "moodle-ai-history-badge";
    badge.textContent = `History: ${count} Q&A`;
    badge.addEventListener("click", async () => {
      try {
        if (!isExtensionValid()) return;
        const sessionId = getSessionId();
        await safeSendMessage({ action: "clearHistory", sessionId });
        badge.remove();
      } catch (e) {
        if (e.message !== "Extension context invalidated") {
          console.warn("Failed to clear history:", e);
        }
      }
    });
    badge.title = "Click to clear conversation history";
    return badge;
  }

  function updateHistoryBadge(count) {
    document.querySelectorAll(".moodle-ai-history-badge").forEach((b) => b.remove());

    if (count > 0) {
      const wrapper = document.querySelector(".moodle-ai-btn-wrapper");
      if (wrapper && !wrapper.querySelector(".moodle-ai-history-badge")) {
        const badge = createHistoryBadge(count);
        wrapper.appendChild(badge);
      }
    }
  }

  function isExtensionValid() {
    try {
      return chrome.runtime && chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  async function safeSendMessage(message) {
    if (!isExtensionValid()) {
      return { error: "Extension context invalidated" };
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            resolve({ error: lastError.message });
          } else {
            resolve(response || {});
          }
        });
      } catch (err) {
        resolve({ error: err.message });
      }
    });
  }

  async function loadHistoryBadge() {
    try {
      if (!isExtensionValid()) return;

      const sessionId = getSessionId();
      const info = await safeSendMessage({ action: "getHistoryInfo", sessionId });
      if (info && info.count > 0) {
        const wrapper = document.querySelector(".moodle-ai-btn-wrapper");
        if (wrapper && !wrapper.querySelector(".moodle-ai-history-badge")) {
          const badge = createHistoryBadge(info.count);
          wrapper.appendChild(badge);
        }
      }
    } catch (e) {
      if (e.message !== "Extension context invalidated") {
        console.warn("Failed to load history badge:", e);
      }
    }
  }

  let injectTimeout = null;

  function injectButtons() {
    if (injectTimeout) {
      clearTimeout(injectTimeout);
      injectTimeout = null;
    }

    const formulations = document.querySelectorAll(
      ".formulation, [class*='question-container']"
    );

    formulations.forEach((formulation) => {
      if (formulation.querySelector(".moodle-ai-btn-wrapper")) return;

      const header = formulation.querySelector(
        ".qtext, .questiontext, .header, h3, h4, [class*='question-header']"
      );

      const { wrapper } = createButtons();

      if (header) {
        header.insertAdjacentElement("afterend", wrapper);
      } else {
        formulation.prepend(wrapper);
      }
    });

    restoreActiveContext().catch(() => {});
    loadHistoryBadge().catch(() => {});
    updateGlobalContextIndicator();
  }

  function updateGlobalContextIndicator() {
    document.querySelectorAll(".moodle-ai-context-indicator").forEach((indicator) => {
      if (activeContextEl) {
        indicator.style.display = "inline-flex";
        indicator.textContent = `Context active`;
        indicator.title = "Context is being used for all AI answers in this session";
      } else {
        indicator.style.display = "none";
      }
    });
  }

  async function restoreActiveContext() {
    try {
      if (!isExtensionValid()) return;

      const contextData = await loadContext();
      if (!contextData.text) return;

      const formulations = document.querySelectorAll(
        ".formulation, [class*='question-container']"
      );

      for (const formulation of formulations) {
        const questionTextEl = formulation.querySelector(".qtext, .questiontext, [class*='question-text']");
        const text = questionTextEl ? questionTextEl.innerText.trim() : formulation.innerText.trim();
        if (text === contextData.text) {
          activeContextEl = formulation;
          formulation.classList.add("moodle-ai-context-active");
          updateContextButtons();
          updateGlobalContextIndicator();
          break;
        }
      }
    } catch (e) {
      if (e.message !== "Extension context invalidated") {
        console.warn("Failed to restore context:", e);
      }
    }
  }

  function showLogModal(prompt, answer) {
    const existingModal = document.querySelector(".moodle-ai-log-modal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.className = "moodle-ai-log-modal";

    modal.innerHTML = `
      <div class="moodle-ai-log-modal-content">
        <div class="moodle-ai-log-modal-header">
          <h3>AI Request Log</h3>
          <button type="button" class="moodle-ai-log-close-btn">&times;</button>
        </div>
        <div class="moodle-ai-log-tabs">
          <button type="button" class="moodle-ai-log-tab active" data-tab="prompt">Prompt</button>
          <button type="button" class="moodle-ai-log-tab" data-tab="response">Response</button>
        </div>
        <div class="moodle-ai-log-body">
          <div class="moodle-ai-log-tab-content active" data-tab="prompt">
            <pre>${escapeHtml(prompt)}</pre>
          </div>
          <div class="moodle-ai-log-tab-content" data-tab="response">
            <pre>${escapeHtml(answer)}</pre>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector(".moodle-ai-log-close-btn").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

    modal.querySelectorAll(".moodle-ai-log-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        modal.querySelectorAll(".moodle-ai-log-tab").forEach((t) => t.classList.remove("active"));
        modal.querySelectorAll(".moodle-ai-log-tab-content").forEach((c) => c.classList.remove("active"));
        tab.classList.add("active");
        modal.querySelector(`.moodle-ai-log-tab-content[data-tab="${tab.dataset.tab}"]`).classList.add("active");
      });
    });
  }

  const AUTO_RUN_KEY = "autoRun";
  const AUTO_MAX_PAGES = 100;
  const AUTO_START_DELAY_MS = 1500;
  let autoRunning = false;
  let autoPanel = null;

  async function getAutoRunState() {
    if (!isExtensionValid()) return { active: false };
    const stored = await chrome.storage.local.get([AUTO_RUN_KEY]);
    return stored[AUTO_RUN_KEY] || { active: false };
  }

  async function patchAutoRun(patch) {
    const next = { ...(await getAutoRunState()), ...patch };
    await chrome.storage.local.set({ [AUTO_RUN_KEY]: next });
    renderAutoPanel(next);
    return next;
  }

  function getAnswerButton(formulation) {
    return formulation.querySelector(".moodle-ai-btn:not(.moodle-ai-context-btn)");
  }

  function findNextPageButton() {
    // Moodle reuses name="next" for both "Next page" and "Finish attempt", so check the label.
    return [...document.querySelectorAll("input[name='next'], button[name='next']")]
      .find((el) => {
        if (el.disabled) return false;
        const label = (el.value || el.textContent || "").trim();
        if (/finish|submit|закончить|завершить|отправ/i.test(label)) return false;
        return /next|следующ/i.test(label);
      }) || null;
  }

  function renderAutoPanel(state = {}) {
    if (!autoPanel) return;
    const toggle = autoPanel.querySelector(".moodle-ai-auto-toggle");
    const status = autoPanel.querySelector(".moodle-ai-auto-status");
    toggle.textContent = state.active ? "Stop auto-answer" : "Auto-answer all pages";
    toggle.classList.toggle("moodle-ai-auto-toggle-active", !!state.active);
    status.textContent = state.message || "";
  }

  function initAutoPanel() {
    autoPanel = document.createElement("div");
    autoPanel.className = "moodle-ai-auto-panel";
    autoPanel.innerHTML = `
      <button type="button" class="moodle-ai-auto-toggle"></button>
      <div class="moodle-ai-auto-status"></div>
    `;
    autoPanel.querySelector(".moodle-ai-auto-toggle").addEventListener("click", onAutoToggle);
    document.body.appendChild(autoPanel);
    getAutoRunState().then(renderAutoPanel).catch(() => {});
  }

  async function onAutoToggle() {
    const state = await getAutoRunState();
    if (state.active) {
      await patchAutoRun({ active: false, message: "Stopped by user." });
      return;
    }
    await patchAutoRun({ active: true, pagesDone: 0, message: "Starting..." });
    runAutoPage();
  }

  async function resumeAutoRun() {
    const state = await getAutoRunState();
    if (!state.active) return;
    await new Promise((resolve) => setTimeout(resolve, AUTO_START_DELAY_MS));
    runAutoPage();
  }

  async function runAutoPage() {
    if (autoRunning) return;
    autoRunning = true;
    try {
      const formulations = [...document.querySelectorAll(".formulation")];
      if (formulations.length === 0) {
        await patchAutoRun({ active: false, message: "No questions on this page. Stopped." });
        return;
      }

      for (let i = 0; i < formulations.length; i++) {
        if (!(await getAutoRunState()).active) return;

        const formulation = formulations[i];
        const btn = getAnswerButton(formulation);
        if (!btn || formulation.querySelector(".moodle-ai-answer-success")) continue;

        await patchAutoRun({ message: `Answering question ${i + 1} of ${formulations.length}...` });
        const ok = await answerFormulation(formulation, btn, { forceAutofill: true });
        if (!ok) {
          await patchAutoRun({ active: false, message: `Stopped: question ${i + 1} could not be answered.` });
          return;
        }
      }

      if (!(await getAutoRunState()).active) return;

      const nextBtn = findNextPageButton();
      if (!nextBtn) {
        await patchAutoRun({
          active: false,
          message: "Last question reached. Review the answers and submit the attempt yourself.",
        });
        return;
      }

      const pagesDone = ((await getAutoRunState()).pagesDone || 0) + 1;
      if (pagesDone >= AUTO_MAX_PAGES) {
        await patchAutoRun({ active: false, pagesDone, message: `Stopped: page limit (${AUTO_MAX_PAGES}) reached.` });
        return;
      }

      await patchAutoRun({ pagesDone, message: `Page ${pagesDone} answered. Opening the next page...` });
      nextBtn.click();
    } catch (err) {
      if (err.message !== "Extension context invalidated") {
        console.warn("Auto-answer stopped:", err);
      }
      await patchAutoRun({ active: false, message: `Stopped: ${err.message}` }).catch(() => {});
    } finally {
      autoRunning = false;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  const observer = new MutationObserver((mutations) => {
    let shouldInject = false;
    for (const mutation of mutations) {
      const external = [...mutation.addedNodes].some((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        return !node.matches?.(".moodle-ai-btn-wrapper, .moodle-ai-answer, .moodle-ai-history-badge, .moodle-ai-log-modal, .moodle-ai-auto-panel");
      });
      if (external) {
        shouldInject = true;
        break;
      }
    }
    if (shouldInject && !injectTimeout) {
      injectTimeout = setTimeout(() => {
        injectTimeout = null;
        injectButtons();
      }, 1000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  injectButtons();
  initAutoPanel();
  resumeAutoRun().catch(() => {});
})();
