// Ensure we don't attach multiple listeners if the script is injected twice
if (typeof window.isExtracting === 'undefined') {
  window.isExtracting = false;
  window.stopRequested = false;

  // Listen for messages from popup.js
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // The popup is asking if the script is currently running
    if (request.action === "checkStatus") {
      sendResponse({ isRunning: window.isExtracting });
      return true; // Keeps the message channel open for the response
    }
    
    // The popup told us to stop
    if (request.action === "stopExtraction") {
      console.log("Stop requested by user. Terminating early...");
      window.stopRequested = true;
      sendResponse({ status: "stopping" });
    }
  });
}


(async function exportTableWithPagination() {
  // Prevent overlapping executions
  if (window.isExtracting) return;
  
  window.isExtracting = true;
  window.stopRequested = false;

  const allCsvData = [];
  const seenRows = new Set();
  
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Determine if a cell is simply a checkbox / selection cell
  function isSelectionCell(cell) {
    if (cell.querySelector('input[type="checkbox"], input[type="radio"]')) {
      return true;
    }
    if (cell.querySelector('[role="checkbox"], [role="radio"]')) {
      return true;
    }
    if (cell.getAttribute('role') === 'checkbox' || cell.getAttribute('role') === 'radio') {
      return true;
    }
    const text = (cell.innerText || cell.textContent || "").trim();
    if (text === "") {
      if (cell.querySelector('svg, button, [role="button"], [class*="checkbox"], [class*="select"]')) {
        return true;
      }
    }
    if (cell.querySelector('[aria-label*="Select row" i]') || cell.getAttribute('aria-label') === 'Select row') {
      return true;
    }
    return false;
  }

  // Determine if a row is a bulk-action/settings/toolbar row rather than data
  function isUtilityRow(row) {
    const rowClass = (row.className || "").toLowerCase();
    if (rowClass.includes('action-bar') || rowClass.includes('toolbar') || rowClass.includes('filter') || rowClass.includes('settings')) {
      return true;
    }
    if (row.querySelector('[class*="action-bar"], [class*="toolbar"], [class*="bulk-actions"]')) {
      return true;
    }
    
    // Skip single-cell banner/progress/loading rows
    const cells = row.querySelectorAll('th, td, [role="cell"], [role="columnheader"], [role="gridcell"]');
    if (cells.length === 1 && cells[0].hasAttribute('colspan')) {
      return true;
    }
    
    return false;
  }

  // Clean elements like buttons/SVGs out of a cloned cell before reading its text
  function cleanCellAndGetText(cell) {
    const clonedCell = cell.cloneNode(true);
    
    // Determine if this cell belongs to a header row or is a header cell
    const row = cell.closest('tr, [role="row"]');
    const isHeader = cell.tagName === 'TH' || 
                     cell.getAttribute('role') === 'columnheader' || 
                     (row && (row.querySelector('th') !== null || row.querySelector('[role="columnheader"]') !== null));
    
    const excludeSelectors = [
      'svg',
      'i',
      'input',
      'img',
      '.copy-button',
      '.copy-icon',
      '[aria-label*="Copy" i]',
      '[title*="Copy" i]',
      '[data-tooltip*="Copy" i]',
      'span[role="button"]',
      '[aria-hidden="true"]'
    ];
    
    if (!isHeader) {
      excludeSelectors.push('button');
    }
    
    excludeSelectors.forEach(selector => {
      clonedCell.querySelectorAll(selector).forEach(el => el.remove());
    });
    
    let text = clonedCell.innerText || clonedCell.textContent || "";
    
    // Clean up trailing clipboard/copy labels
    text = text.trim();
    text = text.replace(/\s*Copy\s*text\s*$/i, '');
    text = text.replace(/\s*Copy\s*shared\s*drive\s*id\s*$/i, '');
    text = text.replace(/\s*Copy\s*$/i, '');
    
    return text.replace(/(\r\n|\n|\r)/gm, " ").replace(/"/g, '""').trim();
  }

  // Find the header row and determine which column indexes are valid (i.e. have non-empty headers and are not selection cells)
  function getValidColumnIndexes() {
    const rows = document.querySelectorAll('tr, [role="row"]');
    for (let row of rows) {
      if (isUtilityRow(row)) continue;
      
      const cells = row.querySelectorAll('th, [role="columnheader"]');
      if (cells.length > 0) {
        const allCells = row.querySelectorAll('th, td, [role="cell"], [role="columnheader"], [role="gridcell"]');
        const validIndexes = [];
        
        allCells.forEach((cell, index) => {
          if (isSelectionCell(cell)) return;
          
          const text = cleanCellAndGetText(cell);
          if (text !== "") {
            validIndexes.push(index);
          }
        });
        
        if (validIndexes.length > 0) {
          return validIndexes;
        }
      }
    }
    return null;
  }

  function extractCurrentPage() {
    const rows = document.querySelectorAll('tr, [role="row"]');
    const validColumnIndexes = getValidColumnIndexes();
    
    rows.forEach(row => {
      if (isUtilityRow(row)) return;
      
      const cells = row.querySelectorAll('th, td, [role="cell"], [role="columnheader"], [role="gridcell"]');
      if (cells.length === 0) return;
      
      let rowArray = [];
      
      if (validColumnIndexes && validColumnIndexes.length > 0) {
        validColumnIndexes.forEach(index => {
          if (index < cells.length) {
            const text = cleanCellAndGetText(cells[index]);
            rowArray.push(`"${text}"`);
          } else {
            rowArray.push(`""`);
          }
        });
      } else {
        // Fallback to old behavior if no valid column indexes could be determined
        const activeCells = Array.from(cells).filter(cell => !isSelectionCell(cell));
        if (activeCells.length === 0) return;
        
        activeCells.forEach(cell => {
          const text = cleanCellAndGetText(cell);
          rowArray.push(`"${text}"`);
        });
      }
      
      const rowString = rowArray.join(",");
      
      if (rowString.replace(/"/g, '').replace(/,/g, '').trim() !== "") {
        if (!seenRows.has(rowString)) {
          seenRows.add(rowString);
          allCsvData.push(rowString);
        }
      }
    });
  }

  // Find only the visible pagination next button
  function findVisibleNextButton() {
    const buttons = document.querySelectorAll('button[aria-label*="Next"], button[aria-label*="next"], [data-tooltip*="Next"], [title*="Next"]');
    for (let btn of buttons) {
      const rect = btn.getBoundingClientRect();
      const style = window.getComputedStyle(btn);
      if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
        return btn;
      }
    }
    return null;
  }

  // Robustly click next using standard click and pointer events to cover all JS frameworks
  function robustClick(element) {
    if (!element) return;
    try {
      element.focus();
    } catch (e) {}
    
    element.click();
    
    const events = ['mousedown', 'mouseup', 'click'];
    events.forEach(eventType => {
      const event = new MouseEvent(eventType, {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1
      });
      element.dispatchEvent(event);
    });
  }

  // Signature used to detect if the page actually changed
  function getPageSignature() {
    const rows = document.querySelectorAll('tr, [role="row"]');
    let sig = "";
    rows.forEach(row => {
      if (!isUtilityRow(row)) {
        sig += row.innerText || row.textContent || "";
      }
    });
    return sig;
  }

  let hasNextPage = true;
  let pageCount = 0;

  console.log("Starting data extraction...");

  while (hasNextPage && !window.stopRequested) {
    pageCount++;
    console.log(`Extracting data from page ${pageCount}...`);
    
    extractCurrentPage();

    const nextBtn = findVisibleNextButton();

    if (nextBtn && 
        !nextBtn.disabled && 
        nextBtn.getAttribute('aria-disabled') !== 'true' &&
        !nextBtn.classList.contains('disabled')) {
        
      const oldSignature = getPageSignature();
      console.log("Clicking Next...");
      robustClick(nextBtn);
      
      // Wait for the page signature to change, up to 4 seconds, checking stop requested
      let pageChanged = false;
      const startTime = Date.now();
      while (Date.now() - startTime < 4000) {
        if (window.stopRequested) break;
        await wait(200);
        if (getPageSignature() !== oldSignature) {
          pageChanged = true;
          break;
        }
      }
      
      // Fallback: If page didn't change, try clicking again and check for another 1.5s
      if (!pageChanged && !window.stopRequested) {
        console.warn("Page signature didn't change, retrying click...");
        robustClick(nextBtn);
        
        let retryChanged = false;
        const retryStart = Date.now();
        while (Date.now() - retryStart < 1500) {
          if (window.stopRequested) break;
          await wait(150);
          if (getPageSignature() !== oldSignature) {
            retryChanged = true;
            break;
          }
        }
        
        if (!retryChanged) {
          console.warn("Still no change. Stopping to avoid getting stuck.");
          hasNextPage = false;
        }
      }
      
    } else {
      hasNextPage = false;
      console.log("Reached the end of the pages.");
    }
    
    if (pageCount > 5000) {
      console.warn("Reached page limit.");
      hasNextPage = false;
    }
  }

  if (allCsvData.length > 0) {
    const csvContent = allCsvData.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = `Google_Admin_List_Export_${new Date().getTime()}.csv`;
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
    
    console.log(`Saved ${allCsvData.length} total rows.`);
  } else {
    alert("Table elements were found, but no text could be extracted.");
  }

  // Reset state and tell popup to change back to default UI
  window.isExtracting = false;
  chrome.runtime.sendMessage({ action: "extractionFinished" });
})();