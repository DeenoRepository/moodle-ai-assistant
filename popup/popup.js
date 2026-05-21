document.addEventListener("DOMContentLoaded", async () => {
  const apiKeyInput = document.getElementById("apiKey");
  const modelSelect = document.getElementById("model");
  const autofillCheckbox = document.getElementById("autofill");
  const saveBtn = document.getElementById("saveBtn");
  const status = document.getElementById("status");

  const { apiKey, model, autofill } = await chrome.storage.sync.get(["apiKey", "model", "autofill"]);

  if (apiKey) apiKeyInput.value = apiKey;
  if (model) modelSelect.value = model;
  if (autofill !== undefined) autofillCheckbox.checked = autofill;

  saveBtn.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const autofill = autofillCheckbox.checked;

    if (!apiKey) {
      status.textContent = "Please enter an API key.";
      status.className = "error";
      return;
    }

    await chrome.storage.sync.set({ apiKey, model, autofill });

    status.textContent = "Settings saved successfully!";
    status.className = "success";

    setTimeout(() => {
      status.textContent = "";
    }, 3000);
  });
});
