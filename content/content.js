(function () {
  const BUTTON_TEXT = "AI Answer";
  const LOADING_TEXT = "Loading...";
  const CONTEXT_BTN_TEXT = "Set Context";
  const CLEAR_CONTEXT_TEXT = "Clear Context";
  const CLEAR_HISTORY_TEXT = "Clear History";

  let activeContextEl = null;
  let activeContextImageCount = 0;

  function getSessionId() {
    return window.location.origin + window.location.pathname;
  }

  function extractMediaFromElement(element) {
    const mediaItems = [];
    
    const images = element.querySelectorAll("img");
    images.forEach((img) => {
      if (img.src && !img.src.startsWith("data:")) {
        mediaItems.push({ type: "image", url: img.src, alt: img.alt || "" });
      }
    });
    
    const videos = element.querySelectorAll("video, iframe[src*='youtube'], iframe[src*='vimeo'], iframe[src*='video']");
    videos.forEach((video) => {
      const src = video.src || video.querySelector("source")?.src;
      if (src) {
        mediaItems.push({ type: "video", url: src });
      }
    });
    
    const audios = element.querySelectorAll("audio");
    audios.forEach((audio) => {
      const src = audio.src || audio.querySelector("source")?.src;
      if (src) {
        mediaItems.push({ type: "audio", url: src });
      }
    });
    
    return mediaItems;
  }

  async function loadImageAsBase64(imgElement, maxDimension = 1024) {
    return new Promise((resolve) => {
      try {
        if (!imgElement || !imgElement.complete || !imgElement.naturalWidth) {
          resolve(null);
          return;
        }
        
        let width = imgElement.naturalWidth;
        let height = imgElement.naturalHeight;
        
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }
        
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(imgElement, 0, 0, width, height);
        
        const base64 = canvas.toDataURL("image/jpeg", 0.8);
        const base64Data = base64.split(",")[1];
        
        resolve({
          mimeType: "image/jpeg",
          data: base64Data,
          size: base64Data.length
        });
      } catch (err) {
        if (err.name === "SecurityError") {
          console.warn(`CORS restriction on image: ${imgElement.src}`);
        } else {
          console.warn(`Failed to convert image to base64:`, err);
        }
        resolve(null);
      }
    });
  }

  async function loadContextImagesAsBase64(element) {
    const images = element.querySelectorAll("img");
    const maxImages = 5;
    const imagesToProcess = Array.from(images).slice(0, maxImages);
    
    const loadedImages = [];
    
    for (const img of imagesToProcess) {
      if (img.src && !img.src.startsWith("data:") && img.complete && img.naturalWidth > 0) {
        const result = await loadImageAsBase64(img);
        if (result) {
          loadedImages.push({
            ...result,
            alt: img.alt || "",
            originalUrl: img.src
          });
        }
      }
    }
    
    return loadedImages;
  }

  async function loadContext() {
    const { context, contextUrl, contextImageCount } = await chrome.storage.local.get(["context", "contextUrl", "contextImageCount"]);
    const currentUrl = window.location.origin + window.location.pathname;
    if (contextUrl !== currentUrl) {
      await chrome.storage.local.remove(["context", "contextUrl", "contextImageCount"]);
      return { text: null, imageCount: 0 };
    }
    return { text: context || null, imageCount: contextImageCount || 0 };
  }

  async function setContext(text, element, mediaItems = []) {
    const currentUrl = window.location.origin + window.location.pathname;
    const imageCount = mediaItems.filter(m => m.type === "image").length;
    
    await chrome.storage.local.set({ 
      context: text, 
      contextUrl: currentUrl,
      contextImageCount: imageCount
    });
    activeContextEl = element;
    activeContextImageCount = imageCount;
    element.classList.add("moodle-ai-context-active");
    updateContextButtons();
    updateGlobalContextIndicator();
  }

  async function clearContext() {
    await chrome.storage.local.remove(["context", "contextUrl", "contextImageCount"]);
    if (activeContextEl) {
      activeContextEl.classList.remove("moodle-ai-context-active");
      activeContextEl = null;
      activeContextImageCount = 0;
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
      
      const existingIndicator = btn.querySelector(".moodle-ai-context-media-indicator");
      if (existingIndicator) existingIndicator.remove();
      
      if (isActive && activeContextImageCount > 0) {
        const indicator = document.createElement("span");
        indicator.className = "moodle-ai-context-media-indicator";
        indicator.textContent = `${activeContextImageCount} image${activeContextImageCount > 1 ? "s" : ""}`;
        btn.appendChild(indicator);
      }
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
    let questionText = questionTextEl ? questionTextEl.innerText.trim() : formulation.innerText.trim();
    
    questionText = questionText
      .replace(/\s+/g, ' ')
      .replace(/AI Answer|Set Context|Clear Context/gi, '')
      .trim();

    const type = detectQuestionType(formulation);

    const data = { type, text: questionText };

    if (type.includes("Multiple Choice") || type === "True/False") {
      const options = [];
      const labels = formulation.querySelectorAll(".answer .label, .flex-fill, .col-md-9, [class*='answer']");
      labels.forEach((label) => {
        const text = label.innerText.trim();
        if (text && text.length > 1) {
          options.push(text);
        }
      });

      if (options.length === 0) {
        const inputs = formulation.querySelectorAll('input[type="radio"], input[type="checkbox"]');
        inputs.forEach((input) => {
          const label = input.closest("label") || formulation.querySelector(`label[for="${input.id}"]`);
          if (label) {
            const labelText = label.innerText.trim();
            if (labelText && labelText.length > 1) {
              options.push(labelText);
            }
          }
        });
      }

      data.options = options.filter((opt, index, self) => self.indexOf(opt) === index);
    }

    if (type === "Matching") {
      const selects = formulation.querySelectorAll("select");
      const pairs = [];
      selects.forEach((select) => {
        const row = select.closest("tr, div, li");
        if (row) {
          const rowText = row.innerText;
          const selectText = select.innerText;
          const itemText = rowText.split(selectText)[0].trim();
          const matches = [];
          select.querySelectorAll("option").forEach((opt) => {
            if (opt.value) matches.push(opt.text.trim());
          });
          if (itemText) {
            pairs.push({ item: itemText, matches });
          }
        }
      });
      data.matchingPairs = pairs;
    }

    if (type === "Ordering") {
      const selects = formulation.querySelectorAll("select");
      const items = [];
      selects.forEach((select) => {
        const row = select.closest("tr, div, li, .answer");
        if (row) {
          const rowText = row.innerText.replace(select.innerText, "").trim();
          const options = [];
          select.querySelectorAll("option").forEach((opt) => {
            if (opt.value) options.push({ value: opt.value, text: opt.text.trim() });
          });
          if (rowText) {
            items.push({ text: rowText, select, options });
          }
        }
      });
      data.orderingItems = items;
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
        const label = input.closest("label") || formulation.querySelector(`label[for="${input.id}"]`);
        if (!label) return;

        const labelText = label.innerText.trim().toLowerCase();
        if (isTrue && (/\btrue\b|верно|правильно|да|yes/i.test(labelText))) {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (isFalse && (/\bfalse\b|неверно|неправильно|нет|no/i.test(labelText))) {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
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
          input.checked = false;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });

        const answerLines = normalizedAnswer
          .split(/\n/)
          .map((l) => l.replace(/^\d+[\.\):\s-]+/, "").trim())
          .filter(Boolean);

        inputs.forEach((input) => {
          const label = input.closest("label") || formulation.querySelector(`label[for="${input.id}"]`);
          if (!label) return;

          const labelText = label.innerText.trim();
          const labelTextLower = labelText.toLowerCase();

          const isMatch = answerLines.some((line) => {
            const lineLower = line.toLowerCase();
            return labelTextLower === lineLower ||
                   labelTextLower.includes(lineLower) ||
                   lineLower.includes(labelTextLower);
          });

          if (isMatch) {
            input.checked = true;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      } else {
        inputs.forEach((input) => {
          input.checked = false;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });

        const answerText = normalizedAnswer.replace(/^\d+[\.\):\s-]+/, "").trim();

        inputs.forEach((input) => {
          const label = input.closest("label") || formulation.querySelector(`label[for="${input.id}"]`);
          if (!label) return;

          const labelText = label.innerText.trim();
          const labelTextLower = labelText.toLowerCase();

          if (labelTextLower === answerText ||
              labelTextLower.includes(answerText) ||
              answerText.includes(labelTextLower)) {
            input.checked = true;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      }
    }

    if (questionType === "Short Answer" || questionType === "Essay") {
      const textarea = formulation.querySelector("textarea");
      const textInput = formulation.querySelector('input[type="text"]');
      const target = textarea || textInput;
      if (target) {
        target.value = answer.trim();
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
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

      const selects = formulation.querySelectorAll("select");
      selects.forEach((select) => {
        const row = select.closest("tr, div, li");
        if (!row) return;

        const rowText = row.innerText.split(select.value || "")[0].trim();
        const matchedPair = answerPairs.find(
          (pair) => pair.item.toLowerCase().includes(rowText.toLowerCase()) || rowText.toLowerCase().includes(pair.item.toLowerCase())
        );

        if (matchedPair) {
          const options = select.querySelectorAll("option");
          for (const option of options) {
            if (option.value && option.text.trim().toLowerCase().includes(matchedPair.match.toLowerCase())) {
              select.value = option.value;
              select.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
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
      answerLines.forEach((line) => {
        const match = line.match(/^(\d+)[\.\):\s-]+(.+)$/);
        if (match) {
          orderedItems.push({ position: match[1], text: match[2].trim() });
        } else if (line && !line.toLowerCase().includes("statement")) {
          orderedItems.push({ position: null, text: line });
        }
      });

      if (orderedItems.length > 0 && !orderedItems[0].position) {
        orderedItems.forEach((item, index) => {
          item.position = String(index + 1);
        });
      }

      const selects = formulation.querySelectorAll("select");
      const originalStatements = question.orderingItems || [];
      
      selects.forEach((select, selectIndex) => {
        const row = select.closest("tr, div, li, .answer, .flex-fill, .col-md-9");
        if (!row) return;

        const rowText = row.innerText.replace(select.innerText, "").trim();
        
        let targetPosition = null;
        
        for (const item of orderedItems) {
          const itemText = item.text.toLowerCase().replace(/[^\w\s]/g, '');
          const rowTextClean = rowText.toLowerCase().replace(/[^\w\s]/g, '');
          
          const similarity = calculateSimilarity(itemText, rowTextClean);
          if (similarity > 0.7) {
            targetPosition = item.position;
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
            
            if (optText === targetPosition || optValue === targetPosition ||
                optText === String(targetPosition) || optValue === String(targetPosition)) {
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
      
      const mediaItems = extractMediaFromElement(formulation);
      
      await setContext(contextText, formulation, mediaItems);
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
    
    const contextStatusText = contextData.text
      ? ` (Context active${contextData.imageCount > 0 ? ` + ${contextData.imageCount} image${contextData.imageCount > 1 ? "s" : ""}` : ""})`
      : "";
    
    answerDiv.className = "moodle-ai-answer moodle-ai-answer-loading";
    answerDiv.textContent = `Asking Gemini...${contextStatusText}`;

    try {
      let contextImagesBase64 = [];
      if (contextData.imageCount > 0 && activeContextEl) {
        answerDiv.textContent = "Loading context images...";
        contextImagesBase64 = await loadContextImagesAsBase64(activeContextEl);
      }

      const response = await safeSendMessage({
        action: "getAnswer",
        question: questionData,
        context: contextData.text,
        contextImages: contextImagesBase64,
        sessionId,
      });

      if (response.error) {
        answerDiv.className = "moodle-ai-answer moodle-ai-answer-error";
        answerDiv.textContent = response.error;
      } else {
        const contextStatus = contextData.text
          ? `<span class="moodle-ai-context-status" title="${contextData.text.substring(0, 200)}"> Context active</span>`
          : `<span class="moodle-ai-context-status moodle-ai-context-status-none">No context</span>`;
        
        const imageStatus = contextImagesBase64.length > 0
          ? `<span class="moodle-ai-context-status">🖼️ ${contextImagesBase64.length} image${contextImagesBase64.length > 1 ? "s" : ""} sent</span>`
          : "";

        answerDiv.className = "moodle-ai-answer moodle-ai-answer-success";
        answerDiv.innerHTML = `
          <div class="moodle-ai-answer-header">
            <strong>AI Answer:</strong>
            <div class="moodle-ai-context-indicators">
              ${contextStatus}
              ${imageStatus}
            </div>
          </div>
          <div class="moodle-ai-answer-body">${response.answer.replace(/\n/g, "<br>")}</div>
        `;

        const { autofill } = await chrome.storage.sync.get(["autofill"]);
        if (autofill !== false) {
          autoFillAnswer(formulation, response.answer, questionData.type);
        }

        updateHistoryBadge(response.historyCount, contextImagesBase64.length > 0);
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

  function createHistoryBadge(count, hasImages) {
    const badge = document.createElement("span");
    badge.className = "moodle-ai-history-badge";
    badge.textContent = `History: ${count} Q&A${hasImages ? " + Images" : ""}`;
    badge.addEventListener("click", async () => {
      try {
        if (!isExtensionValid()) return;
        const sessionId = getSessionId();
        await safeSendMessage({ action: "clearHistory", sessionId });
        badge.remove();
        document.querySelectorAll(".moodle-ai-clear-history-btn").forEach((b) => b.remove());
      } catch (e) {
        if (e.message !== "Extension context invalidated") {
          console.warn("Failed to clear history:", e);
        }
      }
    });
    badge.title = "Click to clear conversation history";
    return badge;
  }

  function updateHistoryBadge(count, hasImages = false) {
    document.querySelectorAll(".moodle-ai-history-badge").forEach((b) => b.remove());

    if (count > 0) {
      const wrapper = document.querySelector(".moodle-ai-btn-wrapper");
      if (wrapper && !wrapper.querySelector(".moodle-ai-history-badge")) {
        const badge = createHistoryBadge(count, hasImages);
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
      throw new Error("Extension context invalidated");
    }
    return chrome.runtime.sendMessage(message);
  }

  async function loadHistoryBadge() {
    try {
      if (!isExtensionValid()) return;
      
      const sessionId = getSessionId();
      const info = await safeSendMessage({ action: "getHistoryInfo", sessionId });
      if (info && info.count > 0) {
        const wrapper = document.querySelector(".moodle-ai-btn-wrapper");
        if (wrapper && !wrapper.querySelector(".moodle-ai-history-badge")) {
          const badge = createHistoryBadge(info.count, info.hasMedia);
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
      ".formulation, .que, [class*='question-container'], .formulation.clearfix"
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
        const imageText = activeContextImageCount > 0 ? ` + ${activeContextImageCount} image${activeContextImageCount > 1 ? "s" : ""}` : "";
        indicator.textContent = `Context active${imageText}`;
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
        ".formulation, .que, [class*='question-container'], .formulation.clearfix"
      );

      for (const formulation of formulations) {
        const questionTextEl = formulation.querySelector(".qtext, .questiontext, [class*='question-text']");
        const text = questionTextEl ? questionTextEl.innerText.trim() : formulation.innerText.trim();
        if (text === contextData.text) {
          activeContextEl = formulation;
          activeContextImageCount = contextData.imageCount || 0;
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
