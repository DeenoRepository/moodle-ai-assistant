(function () {
  const BUTTON_TEXT = "AI Answer";
  const LOADING_TEXT = "Loading...";
  const CONTEXT_BTN_TEXT = "Set Context";
  const CLEAR_CONTEXT_TEXT = "Clear Context";

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
    return text
      .replace(/\(Вы ответили\)|\(Answer saved\)|\(Saved\)/gi, '') // remove Moodle status
      .replace(/^[a-z0-9а-яё][\.\)\s-]+\s*/i, '') // remove prefixes like "a.", "1.", "a)", "а)" (Cyrillic and English)
      .replace(/[\s\xa0]+/g, ' ') // normalize all spaces and non-breaking spaces
      .trim();
  }

  function cleanTextForMatching(text) {
    let cleaned = text.toLowerCase();

    // Normalize Latin lookalikes (homoglyphs) to Cyrillic to prevent mixed-script matching failures
    const homoglyphs = {
      'a': 'а',
      'c': 'с',
      'e': 'е',
      'i': 'і',
      'k': 'к',
      'm': 'м',
      'o': 'о',
      'p': 'р',
      's': 'с',
      'x': 'х',
      'y': 'у'
    };

    cleaned = cleaned.split('').map(char => homoglyphs[char] || char).join('');

    return cleaned
      .replace(/[^a-z0-9а-яёі]/gi, '')
      .trim();
  }

  function getElementTextWithoutSelects(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("select, button, .moodle-ai-btn-wrapper, .moodle-ai-answer").forEach(el => el.remove());
    return clone.innerText.trim();
  }

  function getInputLabelText(input, formulation) {
    if (input.id) {
      const label = formulation.querySelector(`label[for="${input.id}"]`);
      if (label && label.innerText.trim()) return label.innerText;
    }

    const parentLabel = input.closest("label");
    if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText;

    let sibling = input.nextElementSibling;
    while (sibling) {
      if (sibling.tagName === "LABEL" || sibling.className.includes("label") || sibling.className.includes("text")) {
        if (sibling.innerText.trim()) return sibling.innerText;
      }
      sibling = sibling.nextElementSibling;
    }

    const container = input.closest(".r0, .r1, .option, .answer, [class*='option'], [class*='choice']");
    if (container) {
      const clone = container.cloneNode(true);
      clone.querySelectorAll('input').forEach(el => el.remove());
      return clone.innerText;
    }

    return "";
  }

  function clickInput(input, formulation) {
    if (input.id) {
      const label = formulation.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.click();
        return;
      }
    }

    const parentLabel = input.closest("label");
    if (parentLabel) {
      parentLabel.click();
      return;
    }

    input.click();
  }

  function getMathText(element) {
    // 1. Check for MathJax v3 data-tex attribute (very common in modern Moodle)
    const mathJaxV3Containers = element.querySelectorAll('[data-tex]');
    if (mathJaxV3Containers.length > 0) {
      let texTexts = [];
      mathJaxV3Containers.forEach(container => {
        texTexts.push(container.getAttribute('data-tex').trim());
      });
      return texTexts.join(' ');
    }

    // 2. Check for MathJax v2 script tags (older Moodle)
    const mathJaxScripts = element.querySelectorAll('script[type^="math/tex"]');
    if (mathJaxScripts.length > 0) {
      let scriptTexts = [];
      mathJaxScripts.forEach(script => {
        scriptTexts.push(script.textContent.trim());
      });
      return scriptTexts.join(' ');
    }

    // 3. Check for LaTeX images (Moodle Tex filter)
    const texImages = element.querySelectorAll('img.tex, img.latex, img[class*="tex"]');
    if (texImages.length > 0) {
      let altTexts = [];
      texImages.forEach(img => {
        if (img.alt) altTexts.push(img.alt.trim());
      });
      if (altTexts.length > 0) return altTexts.join(' ');
    }

    // 4. Check for MathML annotations
    const annotations = element.querySelectorAll('annotation[encoding*="tex"]');
    if (annotations.length > 0) {
      let annotationTexts = [];
      annotations.forEach(ann => {
        annotationTexts.push(ann.textContent.trim());
      });
      return annotationTexts.join(' ');
    }

    // 5. Fallback to text content without interactive elements
    return getElementTextWithoutSelects(element);
  }

  function extractMediaUrlsFromElement(element) {
    const urls = [];
    const images = element.querySelectorAll("img");
    images.forEach((img) => {
      // Filter out small icons like question mark or checkmark icons
      if (img.src && !img.src.startsWith("data:") && img.naturalWidth !== 16 && img.naturalHeight !== 16) {
        urls.push(img.src);
      }
    });
    return urls;
  }

  async function loadContext() {
    const { context, contextUrl, contextImageUrls } = await chrome.storage.local.get(["context", "contextUrl", "contextImageUrls"]);
    const currentUrl = window.location.origin + window.location.pathname;
    if (contextUrl !== currentUrl) {
      await chrome.storage.local.remove(["context", "contextUrl", "contextImageUrls"]);
      return { text: null, imageUrls: [] };
    }
    return { text: context || null, imageUrls: contextImageUrls || [] };
  }

  async function setContext(text, element, imageUrls = []) {
    const currentUrl = window.location.origin + window.location.pathname;

    await chrome.storage.local.set({
      context: text,
      contextUrl: currentUrl,
      contextImageUrls: imageUrls
    });
    activeContextEl = element;
    element.classList.add("moodle-ai-context-active");
    updateContextButtons();
    updateGlobalContextIndicator();
  }

  async function clearContext() {
    await chrome.storage.local.remove(["context", "contextUrl", "contextImageUrls"]);
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
    const hasRadio = formulation.querySelector('input[type="radio"]');
    const hasCheckbox = formulation.querySelector('input[type="checkbox"]');
    const hasTextInput = formulation.querySelector('input[type="text"]');
    const hasTextarea = formulation.querySelector("textarea");
    const selects = formulation.querySelectorAll("select");
    const hasSelect = selects.length > 0;

    const trueFalseText = formulation.textContent;
    const isTrueFalse = /\b(true|false)\b/i.test(trueFalseText) && (hasRadio || hasCheckbox);

    if (isTrueFalse && (hasRadio || hasCheckbox)) return "True/False";
    if (hasCheckbox) return "Multiple Choice (Multiple)";
    if (hasRadio) return "Multiple Choice (Single)";

    if (hasSelect && selects.length > 1) {
      const firstSelect = selects[0];
      const options = firstSelect.querySelectorAll("option");
      const hasNumericOptions = Array.from(options).some((opt) => /^\d+$/.test(opt.text.trim()));
      const hasOrderKeywords = /order|sequence|sort|rank|arrange/i.test(formulation.textContent);

      if (hasNumericOptions || hasOrderKeywords) {
        return "Ordering";
      }
      return "Matching";
    }

    if (hasTextarea) return "Essay";
    if (hasTextInput) return "Short Answer";
    return "Unknown";
  }

  function extractQuestionData(formulation) {
    const questionTextEl = formulation.querySelector(".qtext, .questiontext, [class*='question-text']");
    let questionText = "";
    let imageUrls = [];

    if (questionTextEl) {
      const clone = questionTextEl.cloneNode(true);
      const inputs = clone.querySelectorAll('input[type="text"]');
      inputs.forEach((input, index) => {
        const placeholder = document.createTextNode(`[Input ${index + 1}]`);
        input.parentNode.replaceChild(placeholder, input);
      });
      questionText = clone.innerText.trim();
      imageUrls = extractMediaUrlsFromElement(questionTextEl);
    } else {
      questionText = formulation.innerText.trim();
      imageUrls = extractMediaUrlsFromElement(formulation);
    }

    questionText = questionText
      .replace(/\s+/g, ' ')
      .replace(/AI Answer|Set Context|Clear Context/gi, '')
      .replace(/\(Вы ответили\)|\(Answer saved\)|\(Saved\)/gi, '')
      .trim();

    const type = detectQuestionType(formulation);
    const data = { type, text: questionText, imageUrls };

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

  function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const words1 = str1.split(/\s+/).filter(Boolean);
    const words2 = str2.split(/\s+/).filter(Boolean);

    if (words1.length === 0 || words2.length === 0) return 0;

    let matches = 0;
    words1.forEach(word1 => {
      if (words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
        matches++;
      }
    });

    return matches / Math.max(words1.length, words2.length);
  }

  function autoFillAnswer(formulation, answer, questionType) {
    const normalizedAnswer = answer.trim().toLowerCase();

    if (questionType === "True/False") {
      const isTrue = /\btrue\b|верно|правильно|да|yes/i.test(normalizedAnswer);
      const isFalse = /\bfalse\b|неверно|неправильно|нет|no/i.test(normalizedAnswer);

      const inputs = formulation.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      inputs.forEach((input) => {
        const labelText = getInputLabelText(input, formulation);
        if (!labelText) return;

        const labelTextLower = labelText.trim().toLowerCase();
        if (isTrue && (/\btrue\b|верно|правильно|да|yes/i.test(labelTextLower))) {
          if (!input.checked) clickInput(input, formulation);
        }
        if (isFalse && (/\bfalse\b|неверно|неправильно|нет|no/i.test(labelTextLower))) {
          if (!input.checked) clickInput(input, formulation);
        }
      });
    }

    if (questionType.includes("Multiple Choice")) {
      const isMultiple = questionType.includes("Multiple");
      const inputs = formulation.querySelectorAll(
        isMultiple ? 'input[type="checkbox"]' : 'input[type="radio"]'
      );

      if (isMultiple) {
        inputs.forEach((input) => {
          if (input.checked) {
            clickInput(input, formulation); // Uncheck via click to trigger listeners
          }
        });

        const answerLines = normalizedAnswer
          .split(/\n/)
          .map((l) => cleanTextForMatching(cleanOptionText(l)))
          .filter(Boolean);

        inputs.forEach((input) => {
          const labelText = getInputLabelText(input, formulation);
          if (!labelText) return;

          const labelTextClean = cleanTextForMatching(cleanOptionText(labelText));

          const isMatch = answerLines.some((line) => {
            return labelTextClean === line ||
                   labelTextClean.includes(line) ||
                   line.includes(labelTextClean);
          });

          if (isMatch && !input.checked) {
            clickInput(input, formulation);
          }
        });
      } else {
        const answerClean = cleanTextForMatching(cleanOptionText(answer));

        inputs.forEach((input) => {
          const labelText = getInputLabelText(input, formulation);
          if (!labelText) return;

          const labelTextClean = cleanTextForMatching(cleanOptionText(labelText));

          if (labelTextClean === answerClean ||
              labelTextClean.includes(answerClean) ||
              answerClean.includes(labelTextClean)) {
            if (!input.checked) {
              clickInput(input, formulation);
            }
          }
        });
      }
    }

    if (questionType === "Short Answer" || questionType === "Essay") {
      const textarea = formulation.querySelector("textarea");
      if (textarea) {
        textarea.value = answer.trim();
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const textInputs = formulation.querySelectorAll('input[type="text"]');
        const answerLines = answer.split('\n').map(l => l.trim()).filter(Boolean);

        textInputs.forEach((input, index) => {
          if (index < answerLines.length) {
            input.value = answerLines[index];
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      }
    }

    if (questionType === "Matching") {
      const answerPairs = answer
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s*[-:]\s*/);
          return parts.length >= 2 ? { item: parts[0].trim(), match: parts.slice(1).join("").trim() } : null;
        })
        .filter(Boolean);

      const cleanFormulaForMatching = (text) => {
        return text
          .toLowerCase()
          .replace(/\\frac|\\cdot|\\times/g, '')
          .replace(/[^a-z0-9а-яё]/gi, '')
          .trim();
      };

      const selects = formulation.querySelectorAll("select");
      selects.forEach((select) => {
        const row = select.closest("tr, div, li");
        if (!row) return;

        const rowText = getMathText(row);
        const cleanedRow = cleanFormulaForMatching(rowText);

        let bestPair = null;
        let highestScore = -1;

        answerPairs.forEach((pair) => {
          const cleanedItem = cleanFormulaForMatching(pair.item);
          let score = 0;

          if (cleanedRow === cleanedItem) {
            score = 100;
          } else if (cleanedRow.includes(cleanedItem) || cleanedItem.includes(cleanedRow)) {
            score = 50 + calculateSimilarity(cleanedRow, cleanedItem);
          } else {
            score = calculateSimilarity(cleanedRow, cleanedItem) * 40;
          }

          if (score > highestScore && score > 10) {
            highestScore = score;
            bestPair = pair;
          }
        });

        if (bestPair) {
          const options = select.querySelectorAll("option");
          const cleanedMatchTarget = cleanOptionText(bestPair.match).toLowerCase();

          let bestOption = null;
          let highestOptionScore = -1;

          options.forEach((option) => {
            if (!option.value) return;
            const optionTextClean = cleanOptionText(option.text).toLowerCase();
            let score = 0;

            if (optionTextClean === cleanedMatchTarget) {
              score = 100;
            } else if (optionTextClean.includes(cleanedMatchTarget) || cleanedMatchTarget.includes(optionTextClean)) {
              score = 50 + calculateSimilarity(optionTextClean, cleanedMatchTarget);
            } else {
              score = calculateSimilarity(optionTextClean, cleanedMatchTarget) * 40;
            }

            if (score > highestOptionScore && score > 10) {
              highestOptionScore = score;
              bestOption = option;
            }
          });

          if (bestOption) {
            select.value = bestOption.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
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

      selects.forEach((select, selectIndex) => {
        const row = select.closest("tr, div, li, .answer, .flex-fill, .col-md-9");
        if (!row) return;

        const rowTextClean = cleanOptionText(getMathText(row)).toLowerCase();

        let targetPosition = null;

        for (let i = 0; i < orderedItems.length; i++) {
          const aiItemClean = orderedItems[i].text.toLowerCase().replace(/[^\w\s]/g, '');
          const rowTextRaw = rowTextClean.replace(/[^\w\s]/g, '');

          const similarity = calculateSimilarity(aiItemClean, rowTextRaw);
          if (similarity > 0.5) {
            targetPosition = orderedItems[i].position;
            break;
          }
        }

        if (!targetPosition && selectIndex < orderedItems.length) {
          targetPosition = orderedItems[selectIndex].position;
        }

        if (targetPosition) {
          const options = select.querySelectorAll("option");
          let matched = false;

          for (const option of options) {
            const optText = option.text.trim();
            const optValue = option.value.trim();

            if (optText === String(targetPosition) || optValue === String(targetPosition)) {
              select.value = option.value;
              select.dispatchEvent(new Event("change", { bubbles: true }));
              matched = true;
              break;
            }
          }

          if (!matched && options.length > 0) {
            const positionNum = parseInt(targetPosition);
            if (positionNum > 0 && positionNum <= options.length) {
              const option = options[positionNum - 1];
              if (option && option.value) {
                select.value = option.value;
                select.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          }
        }
      });
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
      const questionTextEl = formulation.querySelector(".qtext, .questiontext, [class*='question-text']");
      const contextText = questionTextEl ? questionTextEl.innerText.trim() : formulation.innerText.trim();

      const imageUrls = extractMediaUrlsFromElement(formulation);

      await setContext(contextText, formulation, imageUrls);
    }
  }

  async function handleAnswerClick(e) {
    const btn = e.target;
    const formulation = btn.closest(".formulation, .que, [class*='question'], .formulation.clearfix");

    if (!formulation) return;

    btn.textContent = LOADING_TEXT;
    btn.disabled = true;

    const questionData = extractQuestionData(formulation);
    const contextData = await loadContext();
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
        questionImageUrls: questionData.imageUrls,
        context: contextData.text,
        contextImageUrls: contextData.imageUrls,
        sessionId,
      });

      if (response.error) {
        answerDiv.className = "moodle-ai-answer moodle-ai-answer-error";
        answerDiv.textContent = response.error;
      } else {
        const contextStatus = contextData.text
          ? `<span class="moodle-ai-context-status" title="${contextData.text.substring(0, 200)}"> Context active</span>`
          : `<span class="moodle-ai-context-status moodle-ai-context-status-none">No context</span>`;

        const qImagesCount = response.loadedQuestionImagesCount || 0;
        const qImageStatus = qImagesCount > 0
          ? `<span class="moodle-ai-context-status">🖼️ ${qImagesCount} question image${qImagesCount > 1 ? "s" : ""}</span>`
          : "";

        const parsed = parseResponse(response.answer);

        let bodyHtml = `<div class="moodle-ai-answer-text" style="font-weight: 600; font-size: 1.1em;">${parsed.answer.replace(/\n/g, "<br>")}</div>`;
        if (parsed.reasoning) {
          const formattedReasoning = renderLatexToHtml(parsed.reasoning);
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
        if (autofill !== false) {
          autoFillAnswer(formulation, parsed.answer, questionData.type);
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

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  const observer = new MutationObserver((mutations) => {
    let shouldInject = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
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
})();
