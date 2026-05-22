const exportBtn = document.getElementById('exportBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');

// 1. When the popup is opened, check if the script is already running
document.addEventListener('DOMContentLoaded', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      // Ask the content script for its current status
      const response = await chrome.tabs.sendMessage(tab.id, { action: "checkStatus" });
      if (response && response.isRunning) {
        setRunningUI();
      } else {
        resetUI();
      }
    } catch (err) {
      // If the content script hasn't been injected yet, it will throw an error. 
      // We just load the default UI in that case.
      resetUI();
    }
  }
});

exportBtn.addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  setRunningUI();

  // Inject and run the script
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });
});

stopBtn.addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Send a message to content.js to break the loop
  chrome.tabs.sendMessage(tab.id, { action: "stopExtraction" });
  
  resetUI();
});

// Listen for a message from content.js saying it naturally finished
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractionFinished") {
    resetUI();
  }
});

function setRunningUI() {
  exportBtn.style.display = 'none';
  stopBtn.style.display = 'block';
  statusDiv.style.display = 'block';
}

function resetUI() {
  exportBtn.style.display = 'block';
  stopBtn.style.display = 'none';
  statusDiv.style.display = 'none';
}