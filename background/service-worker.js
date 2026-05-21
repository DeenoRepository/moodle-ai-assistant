const conversationHistories = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getAnswer") {
    handleGetAnswer(request.question, request.context, request.contextImages, request.sessionId).then(sendResponse);
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

async function handleGetAnswer(question, context, contextImages, sessionId) {
  const { apiKey, model } = await chrome.storage.sync.get(["apiKey", "model"]);
  if (!apiKey) {
    return { error: "API key not set. Please configure it in the extension popup." };
  }

  const selectedModel = model || "gemini-2.0-flash";
  const history = await getOrCreateHistory(sessionId, context, contextImages);

  const isFirstMessage = history.messages.length === 0;
  const hasImages = isFirstMessage && contextImages && contextImages.length > 0;
  const userPrompt = buildUserPrompt(question, isFirstMessage ? context : null, hasImages);
  
  const parts = [{ text: userPrompt }];
  
  if (isFirstMessage && contextImages && contextImages.length > 0) {
    contextImages.forEach((img) => {
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
      const errorData = await response.json();
      return { error: `Gemini API error: ${errorData.error?.message || response.statusText}` };
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!answer) {
      return { error: "No answer received from Gemini." };
    }

    history.messages.push({ role: "model", parts: [{ text: answer }] });

    await saveHistory(sessionId, history);

    return { answer, historyCount: Math.floor(history.messages.length / 2), prompt: userPrompt };
  } catch (err) {
    return { error: `Network error: ${err.message}` };
  }
}

async function getOrCreateHistory(sessionId, context, contextImages) {
  if (conversationHistories[sessionId]) {
    const existing = conversationHistories[sessionId];
    const contextChanged = context && existing.context !== context;
    const imagesChanged = contextImages && JSON.stringify(existing.contextImages) !== JSON.stringify(contextImages);
    
    if (contextChanged || imagesChanged) {
      conversationHistories[sessionId] = { context, contextImages, messages: [] };
    }
    return conversationHistories[sessionId];
  }

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};

  if (allHistories[sessionId]) {
    const contextChanged = context && allHistories[sessionId].context !== context;
    const imagesChanged = contextImages && JSON.stringify(allHistories[sessionId].contextImages) !== JSON.stringify(contextImages);
    
    if (contextChanged || imagesChanged) {
      allHistories[sessionId] = { context, contextImages, messages: [] };
    }
    conversationHistories[sessionId] = allHistories[sessionId];
    return conversationHistories[sessionId];
  }

  const newHistory = { context, contextImages, messages: [] };
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
      hasMedia: conversationHistories[sessionId].contextImages?.length > 0
    };
  }

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};
  if (allHistories[sessionId]) {
    const msgCount = allHistories[sessionId].messages.length;
    return { 
      count: Math.floor(msgCount / 2), 
      hasContext: !!allHistories[sessionId].context,
      hasMedia: allHistories[sessionId].contextImages?.length > 0
    };
  }

  return { count: 0, hasContext: false, hasMedia: false };
}

function buildUserPrompt(question, context, hasImages) {
  const sections = [];

  if (context) {
    sections.push(`## Context\n${context}`);
  }

  if (hasImages) {
    sections.push(`## Context Images\nThe following images are provided as part of the context. Analyze them carefully along with the text context above.`);
  }

  sections.push(`## Question Type\n${question.type}`);
  sections.push(`## Question\n${question.text}`);

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
      instructions.push("Provide a concise, direct answer (1-2 sentences max).");
      instructions.push("Be specific and accurate.");
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

  if (context || hasImages) {
    instructions.push("CRITICAL: Your answer MUST be based SOLELY on the provided Context section and Context Images above.");
    instructions.push("Do NOT use external knowledge, general facts, or assumptions.");
    instructions.push("Step 1: Check if the Context (text and images) contains information relevant to answering the Question.");
    instructions.push("Step 2: If the Context is relevant, use it to determine the correct answer.");
    instructions.push("Step 3: If the Context does NOT contain relevant information, respond with: 'Context does not contain information to answer this question.'");
    instructions.push("NEVER guess or use outside knowledge.");
    if (hasImages) {
      instructions.push("IMPORTANT: The context images may contain crucial information needed to answer the question. Analyze them carefully.");
    }
  }

  sections.push(`## Instructions\n${instructions.join('\n')}`);
  sections.push(`## Answer Format\nReturn ONLY the answer. No explanations, no reasoning, no extra text.`);
  sections.push(`## Important\nThe question may show pre-selected answers (checked checkboxes, selected radio buttons, filled dropdowns). IGNORE these completely. They may be incorrect. Analyze the question independently and provide the correct answer.`);

  return sections.join('\n\n');
}
