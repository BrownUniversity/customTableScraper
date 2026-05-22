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

  function extractCurrentPage() {
    const rows = document.querySelectorAll('tr, [role="row"]');
    
    rows.forEach(row => {
      let cells = row.querySelectorAll('th, td, [role="cell"], [role="columnheader"], [role="gridcell"]');
      let rowArray = [];
      
      cells.forEach(cell => {
        let text = cell.innerText || cell.textContent || "";
        text = text.replace(/(\r\n|\n|\r)/gm, " ").replace(/"/g, '""').trim();
        rowArray.push(`"${text}"`);
      });
      
      const rowString = rowArray.join(",");
      
      if (rowString.replace(/"/g, '').replace(/,/g, '').trim() !== "") {
        if (!seenRows.has(rowString)) {
          seenRows.add(rowString);
          allCsvData.push(rowString);
        }
      }
    });
  }

  let hasNextPage = true;
  let pageCount = 0;

  console.log("Starting data extraction...");

  // The loop will now break if hasNextPage becomes false OR if window.stopRequested becomes true
  while (hasNextPage && !window.stopRequested) {
    pageCount++;
    console.log(`Extracting data from page ${pageCount}...`);
    
    extractCurrentPage();

    const nextBtn = document.querySelector('button[aria-label*="Next"], button[aria-label*="next"], [data-tooltip*="Next"], [title*="Next"]');

    if (nextBtn && 
        !nextBtn.disabled && 
        nextBtn.getAttribute('aria-disabled') !== 'true' &&
        !nextBtn.classList.contains('disabled')) {
        
      nextBtn.click();
      
      // Wait 2.5 seconds total, but check for "stopRequested" every 250ms.
      // This makes the Stop button highly responsive.
      for (let i = 0; i < 10; i++) {
        if (window.stopRequested) break;
        await wait(150); 
      }
      
    } else {
      hasNextPage = false;
      console.log("Reached the end of the pages.");
    }
    
    if (pageCount > 5000) {
      console.warn("Reached 1000 page limit.");
      hasNextPage = false;
    }
  }

  if (allCsvData.length > 0) {
    // Dump data to CSV whether it naturally finished or was stopped early
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