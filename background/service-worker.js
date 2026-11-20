const conversationHistories = {};
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_ITEMS_PER_REQUEST = 8;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getAnswer") {
    const legacyQuestionMedia = (request.questionImageUrls || []).map((url) => ({ type: "image", url }));
    const legacyContextMedia = (request.contextImageUrls || []).map((url) => ({ type: "image", url }));
    handleGetAnswer(
      request.question,
      request.questionMedia || legacyQuestionMedia,
      request.context,
      request.contextMedia || legacyContextMedia,
      request.sessionId
    ).then(sendResponse);
    return true;
  }
  if (request.action === "getModels") {
    handleGetModels(request.endpoint, request.apiKey || "").then(sendResponse);
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

async function fetchMediaAsBase64(media) {
  try {
    if (media.url.startsWith("data:")) {
      const match = media.url.match(/^data:([^;,]+)?(;base64)?,/s);
      if (!match) throw new Error("Invalid data URL");
      const response = await fetch(media.url);
      const blob = await response.blob();
      if (blob.size > MAX_MEDIA_BYTES) throw new Error(`File is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB`);
      const mimeType = match[1] || media.mimeType || "application/octet-stream";
      const detectedType = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : media.type;
      if (!["image", "audio", "video"].includes(detectedType)) throw new Error(`Unsupported MIME type: ${mimeType}`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return { type: detectedType, mimeType, data: btoa(binary), label: media.label || "" };
    }

    const sameOrigin = new URL(media.url).origin === (media.pageOrigin || "");
    const response = await fetch(media.url, { credentials: sameOrigin ? "include" : "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length")) || 0;
    if (contentLength > MAX_MEDIA_BYTES) throw new Error(`File is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB`);
    const blob = await response.blob();
    if (blob.size > MAX_MEDIA_BYTES) throw new Error(`File is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB`);
    const mimeType = blob.type || media.mimeType || "application/octet-stream";
    const detectedType = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : media.type;
    if (!["image", "audio", "video"].includes(detectedType)) throw new Error(`Unsupported MIME type: ${mimeType}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return { type: detectedType, mimeType, data: btoa(binary), label: media.label || "" };
  } catch (error) {
    console.error(`Failed to fetch media from ${media.url}:`, error);
    return null;
  }
}

async function loadMedia(mediaItems) {
  const loaded = [];
  for (const media of mediaItems.slice(0, MAX_MEDIA_ITEMS_PER_REQUEST)) {
    const data = await fetchMediaAsBase64(media);
    if (data) loaded.push(data);
  }
  return loaded;
}

async function handleGetAnswer(question, questionMediaItems, context, contextMediaItems, sessionId) {
  const settings = await chrome.storage.sync.get([
    "model",
    "endpoint",
  ]);
  const apiKey = await getApiKey();
  const selectedModel = settings.model || "";
  const endpoint = (settings.endpoint || "").trim();

  if (!endpoint) {
    return { error: "API endpoint not set. Please configure it in the extension popup." };
  }

  if (!selectedModel) {
    return { error: "Model not set. Please configure it in the extension popup." };
  }

  const history = await getOrCreateHistory(sessionId, context, contextMediaItems);
  const isFirstMessage = history.messages.length === 0;
  const questionMedia = await loadMedia(questionMediaItems);
  const contextMedia = isFirstMessage ? await loadMedia(contextMediaItems) : [];
  const userPrompt = buildUserPrompt(question, isFirstMessage ? context : null, contextMedia, questionMedia);
  const parts = [{ text: userPrompt }];

  [...contextMedia, ...questionMedia].forEach((media) => {
    parts.push({
      inline_data: {
        media_type: media.type,
        mime_type: media.mimeType,
        data: media.data,
        label: media.label,
      },
    });
  });

  history.messages.push({ role: "user", parts });

  try {
    const answer = await requestOpenAICompatible(endpoint, apiKey, selectedModel, history.messages);

    history.messages.push({ role: "model", parts: [{ text: answer }] });
    await saveHistory(sessionId, history);

    return {
      answer,
      historyCount: Math.floor(history.messages.length / 2),
      prompt: userPrompt,
      loadedQuestionMediaCounts: questionMedia.reduce((counts, media) => {
        counts[media.type] = (counts[media.type] || 0) + 1;
        return counts;
      }, {}),
    };
  } catch (err) {
    // Do not retain a failed user request in the in-memory conversation.
    history.messages.pop();
    return { error: err.message };
  }
}

const MAX_IN_MEMORY_SESSIONS = 5;

function touchInMemoryHistory(sessionId, history) {
  delete conversationHistories[sessionId];
  conversationHistories[sessionId] = history;
  const keys = Object.keys(conversationHistories);
  for (let i = 0; i < keys.length - MAX_IN_MEMORY_SESSIONS; i++) {
    delete conversationHistories[keys[i]];
  }
}

async function handleGetModels(endpoint, apiKey) {
  try {
    const chatEndpoint = deriveChatCompletionsEndpoint(parseApiUrl(endpoint));
    const modelsEndpoint = deriveModelsEndpoint(chatEndpoint);
    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(modelsEndpoint.toString(), { method: "GET", headers });
    if (!response.ok) {
      throw new Error(`Models API error: ${await getApiErrorMessage(response)}`);
    }

    const data = await response.json();
    const models = extractModelIds(data);
    return { models, modelsEndpoint: modelsEndpoint.toString() };
  } catch (error) {
    return { error: error.message };
  }
}

function parseApiUrl(endpoint) {
  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch (_) {
    throw new Error("API endpoint is not a valid URL.");
  }

  if (!["http:", "https:"].includes(endpointUrl.protocol)) {
    throw new Error("API endpoint must use HTTP or HTTPS.");
  }

  return endpointUrl;
}

function deriveChatCompletionsEndpoint(endpointUrl) {
  const chatEndpoint = new URL(endpointUrl.toString());
  const path = chatEndpoint.pathname.replace(/\/+$/, "");

  if (/\/chat\/completions$/i.test(path)) {
    chatEndpoint.pathname = path;
  } else if (/\/models$/i.test(path)) {
    chatEndpoint.pathname = path.replace(/\/models$/i, "/chat/completions");
  } else if (/\/completions$/i.test(path)) {
    chatEndpoint.pathname = path.replace(/\/completions$/i, "/chat/completions");
  } else if (/\/responses$/i.test(path)) {
    chatEndpoint.pathname = path.replace(/\/responses$/i, "/chat/completions");
  } else if (!path) {
    chatEndpoint.pathname = "/v1/chat/completions";
  } else {
    chatEndpoint.pathname = `${path}/chat/completions`;
  }

  chatEndpoint.search = "";
  chatEndpoint.hash = "";
  return chatEndpoint;
}

function deriveModelsEndpoint(chatEndpoint) {
  const modelsEndpoint = new URL(chatEndpoint.toString());
  const path = modelsEndpoint.pathname.replace(/\/+$/, "");

  if (/\/chat\/completions$/i.test(path)) {
    modelsEndpoint.pathname = path.replace(/\/chat\/completions$/i, "/models");
  } else if (/\/models$/i.test(path)) {
    modelsEndpoint.pathname = path;
  } else {
    modelsEndpoint.pathname = `${path}/models`;
  }

  modelsEndpoint.search = "";
  modelsEndpoint.hash = "";
  return modelsEndpoint;
}

function extractModelIds(data) {
  const candidates = Array.isArray(data)
    ? data
    : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []));

  return [...new Set(candidates
    .map((model) => typeof model === "string" ? model : (model?.id || model?.name || model?.model))
    .filter((model) => typeof model === "string" && model.trim())
    .map((model) => model.trim()))]
    .sort((a, b) => a.localeCompare(b));
}

async function getApiKey() {
  const stored = await chrome.storage.local.get(["apiKey"]);
  if (stored.apiKey) return stored.apiKey;

  // Migrate a key saved by older versions in chrome.storage.sync.
  const legacy = await chrome.storage.sync.get(["apiKey", "customApiKey"]);
  const legacyKey = legacy.customApiKey || legacy.apiKey || "";
  if (legacyKey) {
    await chrome.storage.local.set({ apiKey: legacyKey });
    await chrome.storage.sync.remove(["apiKey", "customApiKey"]);
  }
  return legacyKey;
}

function messagesContainAudio(messages) {
  return messages.some((message) => message.parts.some((part) => part.inline_data?.media_type === "audio"));
}

async function requestOpenAICompatible(endpoint, apiKey, model, messages, options = {}) {
  const endpointUrl = deriveChatCompletionsEndpoint(parseApiUrl(endpoint));

  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpointUrl.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: messages.map((message) => convertMessageToOpenAI(message, options)),
      temperature: 0.3,
      max_tokens: 2048,
      top_p: 0.95,
    }),
  });

  if (!response.ok) {
    const errorMessage = await getApiErrorMessage(response);
    // Some OpenAI-compatible endpoints reject input_audio with 400; retry once with audio as a text note.
    if (response.status === 400 && !options.audioAsText && messagesContainAudio(messages)) {
      return requestOpenAICompatible(endpoint, apiKey, model, messages, { audioAsText: true });
    }
    throw new Error(`API error at ${endpointUrl.toString()}: ${errorMessage}`);
  }

  const data = await response.json();
  if (data.choices?.[0]?.finish_reason === "length") {
    throw new Error("The model response was truncated (max_tokens reached). Increase the token limit or use a shorter prompt.");
  }
  const rawContent = data.choices?.[0]?.message?.content
    ?? data.choices?.[0]?.text
    ?? data.answer
    ?? data.response
    ?? data.content;
  const answer = normalizeApiAnswer(rawContent);

  if (!answer) {
    throw new Error("No answer received from the API.");
  }

  return answer;
}

function convertMessageToOpenAI(message, options = {}) {
  const role = message.role === "model" ? "assistant" : message.role;
  const hasMedia = message.parts.some((part) => part.inline_data);

  if (!hasMedia) {
    return {
      role,
      content: message.parts.map((part) => part.text || "").join("\n"),
    };
  }

  const content = [];
  message.parts.forEach((part) => {
    if (part.text !== undefined) {
      content.push({ type: "text", text: part.text });
      return;
    }

    if (!part.inline_data) return;
    const media = part.inline_data;
    const dataUrl = `data:${media.mime_type};base64,${media.data}`;
    if (media.media_type === "image") {
      content.push({ type: "image_url", image_url: { url: dataUrl } });
    } else if (media.media_type === "audio" && options.audioAsText) {
      content.push({ type: "text", text: `[Audio attachment${media.label ? `: ${media.label}` : ""} omitted because this endpoint does not accept audio input.]` });
    } else if (media.media_type === "audio") {
      const format = media.mime_type.split("/")[1]?.replace("mpeg", "mp3").replace("x-wav", "wav") || "mp3";
      content.push({ type: "input_audio", input_audio: { data: media.data, format } });
    } else if (media.media_type === "video") {
      content.push({
        type: "text",
        text: `[Video attachment${media.label ? `: ${media.label}` : ""} omitted because OpenAI-compatible chat-completions APIs do not define a universal video payload. Use a video-capable endpoint or provide extracted frames/transcript.]`,
      });
    }
  });

  return { role, content };
}

function normalizeApiAnswer(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : (part?.text || part?.content || ""))
      .join("")
      .trim();
  }

  return "";
}

async function getApiErrorMessage(response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const responseText = await response.text();

  if (!responseText) return fallback;

  try {
    const errorData = JSON.parse(responseText);
    return errorData.error?.message
      || errorData.message
      || errorData.detail
      || fallback;
  } catch (_) {
    return responseText.slice(0, 500);
  }
}

async function getOrCreateHistory(sessionId, context, contextMedia) {
  if (conversationHistories[sessionId]) {
    const existing = conversationHistories[sessionId];
    const contextChanged = context && existing.context !== context;
    const mediaChanged = contextMedia && JSON.stringify(existing.contextMedia || []) !== JSON.stringify(contextMedia);

    if (contextChanged || mediaChanged) {
      conversationHistories[sessionId] = { context, contextMedia, messages: [] };
    }
    return conversationHistories[sessionId];
  }

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};

  if (allHistories[sessionId]) {
    const contextChanged = context && allHistories[sessionId].context !== context;
    const mediaChanged = contextMedia && JSON.stringify(allHistories[sessionId].contextMedia || []) !== JSON.stringify(contextMedia);

    if (contextChanged || mediaChanged) {
      allHistories[sessionId] = { context, contextMedia, messages: [] };
    }
    touchInMemoryHistory(sessionId, allHistories[sessionId]);
    return allHistories[sessionId];
  }

  const newHistory = { context, contextMedia, messages: [] };
  touchInMemoryHistory(sessionId, newHistory);
  return newHistory;
}

async function saveHistory(sessionId, history) {
  touchInMemoryHistory(sessionId, history);

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};
  allHistories[sessionId] = {
    context: history.context,
    contextMedia: history.contextMedia,
    messages: history.messages.map((message) => ({
      role: message.role,
      parts: message.parts.filter((part) => !part.inline_data),
    })),
  };

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
      hasMedia: conversationHistories[sessionId].contextMedia?.length > 0
    };
  }

  const stored = await chrome.storage.local.get(["sessionHistories"]);
  const allHistories = stored.sessionHistories || {};
  if (allHistories[sessionId]) {
    const msgCount = allHistories[sessionId].messages.length;
    return {
      count: Math.floor(msgCount / 2),
      hasContext: !!allHistories[sessionId].context,
      hasMedia: allHistories[sessionId].contextMedia?.length > 0
    };
  }

  return { count: 0, hasContext: false, hasMedia: false };
}

function buildUserPrompt(question, context, contextMedia, questionMedia) {
  const sections = [];

  if (context) {
    sections.push(`## Context\n${context}`);
  }

  if (contextMedia.length > 0) {
    sections.push(`## Context Media\nAttached context media: ${contextMedia.map((media) => media.type).join(", ")}. Analyze supported attachments together with the context text.`);
  }

  sections.push(`## Question Type\n${question.type}`);
  sections.push(`## Question\n${question.text}`);

  if (questionMedia.length > 0) {
    sections.push(`## Question Media\nAttached question media: ${questionMedia.map((media) => media.type).join(", ")}. Analyze all supported attachments. If a video is represented only by a notice, explicitly state that its visual contents were unavailable.`);
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

  if (question.type === "Embedded Cloze" && question.gapCount) {
    const gapLines = (question.gapOptions || []).map((options, i) => options
      ? `Gap ${i + 1}: choose one of: ${options.join(" | ")}`
      : `Gap ${i + 1}: free-text blank, write the missing word(s)`);
    sections.push(`## Gaps\nThere are ${question.gapCount} numbered gaps in the text, in order from 1 to ${question.gapCount}. Fill ALL of them, including free-text blanks:\n${gapLines.join("\n")}`);
  }

  if (question.type === "Drag into Text") {
    const gapLines = (question.dropGroups || []).map((gap) => `[Gap ${gap.place}]: choose one of: ${gap.words.join(" | ")}`);
    sections.push(`## Gaps\nThe text has numbered gaps. Each gap accepts ONLY the words listed for it:\n${gapLines.join("\n")}`);
  }

  if (question.type === "Drag and Drop (Image)") {
    sections.push(`## Labels to Place\n${(question.dragItems || []).join("\n")}`);
    sections.push(`## Numbered Places on the Image\nThe image shows numbered places: ${(question.dropPlaces || []).join(", ")}. Each label belongs to exactly one place.`);
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
    case "Dropdown":
      instructions.push("Select exactly ONE option from the dropdown list.");
      instructions.push("Return ONLY the exact text of the correct option.");
      break;
    case "Short Answer":
      instructions.push("Provide a concise, direct answer (a single number, word, or short phrase).");
      instructions.push("If the question contains placeholders like [Input 1], [Input 2], etc., you MUST provide the answer for each placeholder on a separate line in your <answer> section, in the correct order (e.g. first line for [Input 1], second line for [Input 2], etc.). Do NOT include label prefixes like 'Input 1:' or 'N='.");
      instructions.push("If the answer is a numerical value, return ONLY the number (e.g., '0.5' or '15'). Do NOT include the variable prefix (like 'R =') or unit suffix (like 'm', 'kg', 'м') unless the question does not specify them outside the input box.");
      instructions.push("For numerical values, do NOT round to an integer unless explicitly requested. Keep the fractional part and round to 1 or 2 decimal places (e.g. '214.86' or '214.9') to maintain accuracy for automated grading.");
      if (/кинетическая энергия|kinetic energy/i.test(question.text || "")) {
        instructions.push("Note: if the question asks for kinetic energy of the thermal (chaotic) motion of molecules without specifying 'полная энергия' (full energy) or rotation, use the translational formula E = 1.5 * ν * R * T.");
      }
      instructions.push("Do NOT add ending punctuation like periods to the answer.");
      break;
    case "Drag into Text":
      instructions.push("Fill each numbered gap with one word from the list given for that gap. Each word is used at most once.");
      instructions.push("Return exactly one line per gap in the format 'N: word', using the exact text from that gap's list. Do not repeat the sentence or the question text. Do not add any other text.");
      break;
    case "Drag and Drop (Image)":
      instructions.push("Place each label on the numbered place it belongs to on the image.");
      instructions.push("Return exactly one line per place in the format 'N: label', where N is the place number and label is the exact text from 'Labels to Place'. Use each label once. Do not add any other text.");
      break;
    case "Embedded Cloze":
      instructions.push("Fill every numbered gap. For dropdown gaps choose one option from its list; for free-text gaps write the word or words that fit the sentence.");
      instructions.push("Return exactly one line per gap in the format 'N: word', for example '1: am'. Use the exact text from the Word Options. Do not repeat the sentence or the question text. Do not add any other text.");
      instructions.push("Choose the grammatically and semantically correct form for each gap, using the whole sentence context.");
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

  if (context || contextMedia.length > 0) {
    instructions.push("CRITICAL: Your answer MUST be based SOLELY on the provided Context section and Context Media above.");
    instructions.push("Do NOT use external knowledge, general facts, or assumptions.");
    instructions.push("Step 1: Check if the Context (text and images) contains information relevant to answering the Question.");
    instructions.push("Step 2: If the Context is relevant, use it to determine the correct answer.");
    instructions.push("Step 3: If the Context does NOT contain relevant information, respond with: 'Context does not contain information to answer this question.'");
    instructions.push("NEVER guess or use outside knowledge.");
  }

  sections.push(`## Instructions\n${instructions.join('\n')}`);
  sections.push(`## Answer Format
Respond with the final answer only, wrapped exactly like this:
<answer>
[Write ONLY the final answer here, formatted exactly as requested in the instructions. No extra text, no explanation.]
</answer>`);

  return sections.join('\n\n');
}
