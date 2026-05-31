const conversationHistories = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getAnswer") {
    handleGetAnswer(
      request.question,
      request.questionImageUrls || [],
      request.context,
      request.contextImageUrls || [],
      request.sessionId
    ).then(sendResponse);
    return true;
  }
  if (request.action === "clearHistory") {
    clearHistory(request.sessionId).then(sendResponse);
    return true;
  }
  if (request.action === "getHistoryInfo") {
    getHistoryInfo(request.sessionId).then(sendResponse);
    return true;
  }
});

// Helper function to fetch images in background to bypass content script CORS issues
async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    
    // Convert arrayBuffer to base64
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Data = btoa(binary);
    
    return {
      mimeType: blob.type || "image/jpeg",
      data: base64Data
    };
  } catch (error) {
    console.error(`Failed to fetch image from ${url}:`, error);
    return null;
  }
}

async function handleGetAnswer(question, questionImageUrls, context, contextImageUrls, sessionId) {
  const { apiKey, model } = await chrome.storage.sync.get(["apiKey", "model"]);
  if (!apiKey) {
    return { error: "API key not set. Please configure it in the extension popup." };
  }

  const selectedModel = model || "gemini-2.0-flash";
  const history = await getOrCreateHistory(sessionId, context, contextImageUrls);

  const isFirstMessage = history.messages.length === 0;

  // Resolve images in background
  const questionImages = [];
  for (const url of questionImageUrls) {
    const imgData = await fetchImageAsBase64(url);
    if (imgData) questionImages.push(imgData);
  }

  const contextImages = [];
  if (isFirstMessage) {
    for (const url of contextImageUrls) {
      const imgData = await fetchImageAsBase64(url);
      if (imgData) contextImages.push(imgData);
    }
  }

  const hasContextImages = contextImages.length > 0;
  const hasQuestionImages = questionImages.length > 0;

  const userPrompt = buildUserPrompt(question, isFirstMessage ? context : null, hasContextImages, hasQuestionImages);
  
  const parts = [{ text: userPrompt }];
  
  // Attach context images on first message
  if (isFirstMessage && hasContextImages) {
    contextImages.forEach((img) => {
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.data
        }
      });
    });
  }

  // Attach question images for this specific question
  if (hasQuestionImages) {
    questionImages.forEach((img) => {
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.data
        }
      });
    });
  }

  history.messages.push({ role: "user", parts });

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: history.messages.map((m) => ({ role: m.role, parts: m.parts })),
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
          topP: 0.95,
        },
      }),
    });

    if (!response.ok) {
      let errorMsg = response.statusText;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) {
          errorMsg = errorData.error.message;
        }
      } catch (_) {}
      return { error: `Gemini API error: ${errorMsg}` };
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!answer) {
      return { error: "No answer received from Gemini." };
    }

    history.messages.push({ role: "model", parts: [{ text: answer }] });

    await saveHistory(sessionId, history);

    return { 
      answer, 
      historyCount: Math.floor(history.messages.length / 2), 
      prompt: userPrompt,
      loadedQuestionImagesCount: questionImages.length
    };
  } catch (err) {
    return { error: `Network error: ${err.message}` };
  }
}

async function getOrCreateHistory(sessionId, context, contextImageUrls) {
  if (conversationHistories[sessionId]) {
    const existing = conversationHistories[sessionId];
    const contextChanged = context && existing.context !== context;
    const imagesChanged = contextImageUrls && JSON.stringify(existing.contextImageUrls) !== JSON.stringify(contextImageUrls);
    
    if (contextChanged || imagesChanged) {
      conversationHistories[sessionId] = { context, contextImageUrls, messages: [] };
    }
    return conversationHistories[sessionId];
  }

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};

  if (allHistories[sessionId]) {
    const contextChanged = context && allHistories[sessionId].context !== context;
    const imagesChanged = contextImageUrls && JSON.stringify(allHistories[sessionId].contextImageUrls) !== JSON.stringify(contextImageUrls);
    
    if (contextChanged || imagesChanged) {
      allHistories[sessionId] = { context, contextImageUrls, messages: [] };
    }
    conversationHistories[sessionId] = allHistories[sessionId];
    return conversationHistories[sessionId];
  }

  const newHistory = { context, contextImageUrls, messages: [] };
  conversationHistories[sessionId] = newHistory;
  return newHistory;
}

async function saveHistory(sessionId, history) {
  conversationHistories[sessionId] = history;

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};
  allHistories[sessionId] = history;

  const maxSessions = 5;
  const keys = Object.keys(allHistories);
  if (keys.length > maxSessions) {
    for (let i = 0; i < keys.length - maxSessions; i++) {
      delete allHistories[keys[i]];
    }
  }

  await chrome.storage.local.set({ sessionHistories: allHistories });
}

async function clearHistory(sessionId) {
  delete conversationHistories[sessionId];

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};
  delete allHistories[sessionId];
  await chrome.storage.local.set({ sessionHistories: allHistories });

  return { cleared: true };
}

async function getHistoryInfo(sessionId) {
  if (conversationHistories[sessionId]) {
    const msgCount = conversationHistories[sessionId].messages.length;
    return { 
      count: Math.floor(msgCount / 2), 
      hasContext: !!conversationHistories[sessionId].context,
      hasMedia: conversationHistories[sessionId].contextImageUrls?.length > 0
    };
  }

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};
  if (allHistories[sessionId]) {
    const msgCount = allHistories[sessionId].messages.length;
    return { 
      count: Math.floor(msgCount / 2), 
      hasContext: !!allHistories[sessionId].context,
      hasMedia: allHistories[sessionId].contextImageUrls?.length > 0
    };
  }

  return { count: 0, hasContext: false, hasMedia: false };
}

function buildUserPrompt(question, context, hasContextImages, hasQuestionImages) {
  const sections = [];

  if (context) {
    sections.push(`## Context\n${context}`);
  }

  if (hasContextImages) {
    sections.push(`## Context Images\nThe following images are provided as part of the context. Analyze them carefully along with the text context above.`);
  }

  sections.push(`## Question Type\n${question.type}`);
  sections.push(`## Question\n${question.text}`);

  if (hasQuestionImages) {
    sections.push(`## Question Images\nThe following images belong directly to the question. Analyze them carefully to answer the question.`);
  }

  if (question.options && question.options.length > 0) {
    sections.push(`## Options\n${question.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}`);
  }

  if (question.matchingPairs && question.matchingPairs.length > 0) {
    const items = question.matchingPairs.map(p => p.item).join('\n');
    const allMatches = [...new Set(question.matchingPairs.flatMap(p => p.matches))].join('\n');
    sections.push(`## Items to Match\n${items}`);
    sections.push(`## Available Matches\n${allMatches}`);
  }

  if (question.orderingItems && question.orderingItems.length > 0) {
    sections.push(`## Statements to Order (arrange these in correct order):\n${question.orderingItems.map((item, i) => `Statement ${i + 1}: ${item.text}`).join('\n')}`);
  }

  const instructions = [];
  
  switch (question.type) {
    case "Multiple Choice (Single)":
      instructions.push("Select exactly ONE correct option.");
      instructions.push("Return ONLY the exact text of the correct option.");
      instructions.push("IMPORTANT: Ignore any pre-selected answers shown in the question. Determine the correct answer independently.");
      break;
    case "Multiple Choice (Multiple)":
      instructions.push("Select ALL correct options (there may be multiple).");
      instructions.push("Return each correct option on a separate line, using exact text.");
      instructions.push("IMPORTANT: Ignore any pre-selected checkboxes shown in the question. Determine the correct answers independently.");
      break;
    case "True/False":
      instructions.push("Answer with exactly one word: True or False.");
      instructions.push("IMPORTANT: Ignore any pre-selected radio button shown in the question. Determine the correct answer independently.");
      break;
    case "Short Answer":
      instructions.push("Provide a concise, direct answer (a single number, word, or short phrase).");
      instructions.push("If the question contains placeholders like [Input 1], [Input 2], etc., you MUST provide the answer for each placeholder on a separate line in your <answer> section, in the correct order (e.g. first line for [Input 1], second line for [Input 2], etc.). Do NOT include label prefixes like 'Input 1:' or 'N='.");
      instructions.push("If the answer is a numerical value, return ONLY the number (e.g., '0.5' or '15'). Do NOT include the variable prefix (like 'R =') or unit suffix (like 'm', 'kg', 'м') unless the question does not specify them outside the input box.");
      instructions.push("For numerical values, do NOT round to an integer unless explicitly requested. Keep the fractional part and round to 1 or 2 decimal places (e.g. '214.86' or '214.9') to maintain accuracy for automated grading.");
      instructions.push("Do NOT add ending punctuation like periods to the answer.");
      break;
    case "Essay":
      instructions.push("Provide a well-structured answer with clear reasoning.");
      instructions.push("Include key points and explanations.");
      break;
    case "Matching":
      instructions.push("Match each item with its correct corresponding match.");
      instructions.push("Format: 'Item: Match' on separate lines.");
      break;
    case "Ordering":
      instructions.push("CRITICAL: Return ONLY the numbered list of statements in correct order.");
      instructions.push("DO NOT include any introductory text like 'Based on...', 'The correct order is...', etc.");
      instructions.push("DO NOT include any explanations or reasoning.");
      instructions.push("Start your response directly with '1. ' followed by the first statement.");
      instructions.push("Format:");
      instructions.push("1. [exact text of statement that goes first]");
      instructions.push("2. [exact text of statement that goes second]");
      instructions.push("3. [etc.]");
      instructions.push("Use the EXACT text from the statements provided. Do not modify or paraphrase.");
      break;
    default:
      instructions.push("Provide the most accurate answer possible.");
  }

  if (context || hasContextImages) {
    instructions.push("CRITICAL: Your answer MUST be based SOLELY on the provided Context section and Context Images above.");
    instructions.push("Do NOT use external knowledge, general facts, or assumptions.");
    instructions.push("Step 1: Check if the Context (text and images) contains information relevant to answering the Question.");
    instructions.push("Step 2: If the Context is relevant, use it to determine the correct answer.");
    instructions.push("Step 3: If the Context does NOT contain relevant information, respond with: 'Context does not contain information to answer this question.'");
    instructions.push("NEVER guess or use outside knowledge.");
  }

  sections.push(`## Instructions\n${instructions.join('\n')}`);
  sections.push(`## Answer Format
CRITICAL: You MUST think step-by-step before answering to ensure mathematical and physics formulas are applied correctly (e.g. correct moment of inertia).
You must format your response exactly like this:
<reasoning>
[Write your step-by-step derivation, formula selection, and calculation here. Show your thoughts.]
</reasoning>
<answer>
[Write ONLY the final cleaned answer here, formatted exactly as requested in the instructions. No extra text, no explanation.]
</answer>`);

  return sections.join('\n\n');
}
