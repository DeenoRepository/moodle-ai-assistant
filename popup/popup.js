document.addEventListener("DOMContentLoaded", async () => {
  const endpointInput = document.getElementById("endpoint");
  const apiKeyInput = document.getElementById("apiKey");
  const modelInput = document.getElementById("model");
  const availableModels = document.getElementById("availableModels");
  const loadModelsBtn = document.getElementById("loadModelsBtn");
  const modelsHint = document.getElementById("modelsHint");
  const autofillCheckbox = document.getElementById("autofill");
  const saveBtn = document.getElementById("saveBtn");
  const status = document.getElementById("status");

  const settings = await chrome.storage.sync.get([
    "apiKey",
    "model",
    "customApiKey",
    "customModel",
    "endpoint",
    "autofill",
  ]);

  endpointInput.value = settings.endpoint || "";
  apiKeyInput.value = settings.customApiKey ?? settings.apiKey ?? "";
  modelInput.value = settings.customModel || settings.model || "";
  if (settings.autofill !== undefined) autofillCheckbox.checked = settings.autofill;

  function showStatus(message, type = "") {
    status.textContent = message;
    status.className = type;
  }

  function validateEndpoint() {
    const endpoint = endpointInput.value.trim();
    if (!endpoint) {
      throw new Error("Please enter the API endpoint.");
    }

    let endpointUrl;
    try {
      endpointUrl = new URL(endpoint);
    } catch (_) {
      throw new Error("Please enter a valid endpoint URL.");
    }

    if (!["http:", "https:"].includes(endpointUrl.protocol)) {
      throw new Error("Endpoint must use HTTP or HTTPS.");
    }

    return endpoint;
  }

  function populateModels(models) {
    availableModels.replaceChildren();
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      availableModels.appendChild(option);
    });
  }

  loadModelsBtn.addEventListener("click", async () => {
    let endpoint;
    try {
      endpoint = validateEndpoint();
    } catch (error) {
      showStatus(error.message, "error");
      return;
    }

    loadModelsBtn.disabled = true;
    loadModelsBtn.textContent = "Loading Models...";
    showStatus("");

    try {
      const response = await chrome.runtime.sendMessage({
        action: "getModels",
        endpoint,
        apiKey: apiKeyInput.value.trim(),
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      const models = response?.models || [];
      populateModels(models);

      if (models.length === 0) {
        throw new Error("The endpoint returned no models.");
      }

      if (!models.includes(modelInput.value.trim())) {
        modelInput.value = models[0];
      }

      modelsHint.textContent = `${models.length} model${models.length === 1 ? "" : "s"} loaded from ${response.modelsEndpoint}.`;
      showStatus("Models loaded successfully!", "success");
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      loadModelsBtn.disabled = false;
      loadModelsBtn.textContent = "Load Models from Endpoint";
    }
  });

  saveBtn.addEventListener("click", async () => {
    let endpoint;
    try {
      endpoint = validateEndpoint();
    } catch (error) {
      showStatus(error.message, "error");
      return;
    }

    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim();
    const autofill = autofillCheckbox.checked;

    if (!model) {
      showStatus("Please load or enter a model name.", "error");
      return;
    }

    await chrome.storage.sync.set({
      apiKey,
      model,
      customApiKey: apiKey,
      customModel: model,
      endpoint,
      autofill,
    });
    await chrome.storage.sync.remove(["provider"]);

    showStatus("Settings saved successfully!", "success");
    setTimeout(() => showStatus(""), 3000);
  });
});
