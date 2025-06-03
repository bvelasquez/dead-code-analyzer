// Global variables
const selectedFiles = new Set();
let currentAnalysisData = null;
let currentView = "detailed";
let currentTargetDir = null;

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  getCurrentTargetDir();
  loadAnalysisData();
  restoreViewPreference();
  setupEventListeners();
  setupAutoRefresh();
});

// Get the current target directory from the server
async function getCurrentTargetDir() {
  try {
    const response = await fetch("/api/target-directory");

    if (response.ok) {
      const data = await response.json();
      currentTargetDir = data.targetDir;
      updateTargetDirectoryDisplay();
    } else {
      console.error("Failed to get current target directory");
      currentTargetDir = "Unknown";
      updateTargetDirectoryDisplay();
    }
  } catch (error) {
    console.error("Error fetching target directory:", error);
    currentTargetDir = "Unknown";
    updateTargetDirectoryDisplay();
  }
}

// Update the target directory display in the UI
function updateTargetDirectoryDisplay() {
  const currentTargetElement = document.getElementById("currentTarget");
  currentTargetElement.textContent = `Current target: ${currentTargetDir}`;

  // Also update the input field with the current target
  document.getElementById("targetDir").value = currentTargetDir;
}

// Set a new target directory and run analysis
async function setTargetDirectoryAndAnalyze() {
  const targetDirInput = document.getElementById("targetDir");
  const newTargetDir = targetDirInput.value.trim();

  if (!newTargetDir) {
    showNotification("Please enter a valid target directory path", "warning");
    return;
  }

  showLoading(true, "Setting new target directory and running analysis...");

  try {
    const response = await fetch("/api/analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetDir: newTargetDir }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log("Analysis completed:", result);

    showNotification(
      "Target directory set and analysis completed successfully",
      "success",
    );
    currentTargetDir = newTargetDir;
    updateTargetDirectoryDisplay();

    // Reload the analysis data
    await loadAnalysisData();
  } catch (error) {
    console.error("Error setting target directory:", error);
    showNotification(
      `Failed to set target directory: ${error.message}`,
      "error",
    );
  } finally {
    showLoading(false);
  }
}

// Setup event listeners
function setupEventListeners() {
  // View toggle buttons
  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      switchView(this.dataset.view);
    });
  });

  // Action buttons
  document
    .getElementById("refreshBtn")
    .addEventListener("click", refreshAnalysis);
  document.getElementById("selectAllBtn").addEventListener("click", selectAll);
  document
    .getElementById("selectNoneBtn")
    .addEventListener("click", selectNone);
  document
    .getElementById("selectOrphanedBtn")
    .addEventListener("click", selectOrphaned);
  document
    .getElementById("selectTransitiveBtn")
    .addEventListener("click", selectTransitive);
  document
    .getElementById("deleteSelectedBtn")
    .addEventListener("click", deleteSelected);
  document
    .getElementById("generateScriptBtn")
    .addEventListener("click", generateScript);

  // Target directory selection
  document
    .getElementById("setTargetBtn")
    .addEventListener("click", setTargetDirectoryAndAnalyze);

  // Quick target selection dropdown
  document
    .getElementById("quickTargets")
    .addEventListener("change", function () {
      if (this.value) {
        document.getElementById("targetDir").value = this.value;
      }
    });

  // Setup compact view event handlers
  setupCompactViewEventHandlers();
}

// Attach event listeners to file checkboxes
function attachFileCheckboxListeners() {
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const fileName = this.dataset.file;
      const fileItem = this.closest(
        ".compact-file-item, .compact-table-row, .file-item, .file-tile",
      );

      if (this.checked) {
        selectedFiles.add(fileName);
        if (fileItem) {
          fileItem.classList.add("selected");
        }
      } else {
        selectedFiles.delete(fileName);
        if (fileItem) {
          fileItem.classList.remove("selected");
        }
      }

      updateSelectedCount();
      updateDeleteButton();
    });
  });

  // Add click event to entire file tiles for easier selection
  document.querySelectorAll(".file-tile").forEach((tile) => {
    tile.addEventListener("click", function (event) {
      // Don't trigger if clicking on a button or checkbox or their containers
      if (
        event.target.closest(".file-checkbox-wrapper") ||
        event.target.closest(".file-actions") ||
        event.target.closest(".file-action-btn")
      ) {
        return;
      }

      const checkbox = this.querySelector(".file-checkbox");
      if (checkbox && !checkbox.disabled) {
        checkbox.checked = !checkbox.checked;

        // Manually trigger change event
        const changeEvent = new Event("change", { bubbles: true });
        checkbox.dispatchEvent(changeEvent);
      }
    });
  });
}

// Setup auto-refresh functionality
function setupAutoRefresh() {
  // Refresh every 30 seconds
  setInterval(() => {
    loadAnalysisData();
  }, 30000);
}

// Restore view preference from localStorage
function restoreViewPreference() {
  const savedView = localStorage.getItem("deadCodeAnalyzer.view");
  if (savedView && ["detailed", "compact"].includes(savedView)) {
    currentView = savedView;
  }

  // Update button states to reflect the current view
  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.dataset.view === currentView) {
      btn.classList.add("active");
    }
  });
}

// Save view preference to localStorage
function saveViewPreference() {
  localStorage.setItem("deadCodeAnalyzer.view", currentView);
}

// Load analysis data from the server
async function loadAnalysisData() {
  showLoading(true, "Loading analysis data...");

  try {
    const response = await fetch("/api/analysis");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    currentAnalysisData = await response.json();
    updateUI();
    showNotification("Analysis data loaded successfully", "success");
  } catch (error) {
    console.error("Error loading analysis data:", error);
    showNotification(`Failed to load analysis data: ${error.message}`, "error");
    // Show empty state
    updateUI({
      totalFiles: 0,
      reachableFiles: [],
      unreachableFiles: [],
      chainAnalysis: {},
      entryPoints: [],
    });
  } finally {
    showLoading(false);
  }
}

// Update the UI with current data
function updateUI() {
  if (!currentAnalysisData) {
    return;
  }

  const data = processAnalysisData(currentAnalysisData);
  updateStatsGrid(data.summary);
  updateEntryPointsSection(data.entryPointsList);
  updateFileContent(data);
}

// Process raw analysis data into display format
function processAnalysisData(rawData) {
  const chainAnalysis = rawData.chainAnalysis || {};

  // Group by category
  const categories = {
    orphaned: [],
    "transitive-dead-code": [],
    "false-positive": [],
  };

  Object.entries(chainAnalysis).forEach(([file, info]) => {
    if (info.isOrphaned) {
      categories.orphaned.push({ file, analysis: info });
    } else if (info.summary && info.summary.includes("FALSE POSITIVE")) {
      categories["false-positive"].push({ file, analysis: info });
    } else if (info.summary && info.summary.includes("Transitive dead code")) {
      categories["transitive-dead-code"].push({ file, analysis: info });
    }
  });

  return {
    categories,
    summary: {
      totalFiles: rawData.totalFiles || 0,
      reachableFiles: rawData.reachableFiles
        ? rawData.reachableFiles.length
        : 0,
      unreachableFiles: rawData.unreachableFiles
        ? rawData.unreachableFiles.length
        : 0,
      entryPoints: rawData.entryPoints ? rawData.entryPoints.length : 0,
      orphanedCount: categories.orphaned.length,
      transitiveCount: categories["transitive-dead-code"].length,
      falsePositiveCount: categories["false-positive"].length,
    },
    chainAnalysis: rawData.chainAnalysis || {},
    entryPointsList: rawData.entryPoints || [],
  };
}

// Update the stats grid
function updateStatsGrid(summary) {
  const statsGrid = document.getElementById("statsGrid");
  const totalFiles = summary.totalFiles || 0;
  const reachablePercent = totalFiles
    ? ((summary.reachableFiles / totalFiles) * 100).toFixed(1)
    : 0;
  const unreachablePercent = totalFiles
    ? ((summary.unreachableFiles / totalFiles) * 100).toFixed(1)
    : 0;

  statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-number">${summary.totalFiles}</div>
            <div class="stat-label">Total Files</div>
        </div>
        <div class="stat-card">
            <div class="stat-number reachable">${summary.reachableFiles}</div>
            <div class="stat-label">Reachable (${reachablePercent}%)</div>
        </div>
        <div class="stat-card">
            <div class="stat-number unreachable">${summary.unreachableFiles}</div>
            <div class="stat-label">Unreachable (${unreachablePercent}%)</div>
        </div>
        <div class="stat-card">
            <div class="stat-number orphaned">${summary.orphanedCount}</div>
            <div class="stat-label">Orphaned Files</div>
        </div>
        <div class="stat-card">
            <div class="stat-number transitive">${summary.transitiveCount}</div>
            <div class="stat-label">Transitive Dead Code</div>
        </div>
        <div class="stat-card">
            <div class="stat-number entry-points">${summary.entryPoints}</div>
            <div class="stat-label">Entry Points</div>
        </div>
    `;
}

// Update the entry points section
function updateEntryPointsSection(entryPoints) {
  const section = document.getElementById("entryPointsSection");

  section.innerHTML = `
        <h4>🚀 Analysis Entry Points (${entryPoints.length})</h4>
        <p>These are the starting points used for the dependency analysis. All reachable files must have a path from one of these entry points:</p>
        <div class="entry-points-grid">
            ${entryPoints.map((ep) => `<div class="entry-point-item">📍 ${ep}</div>`).join("")}
        </div>
    `;
}

// Update file content area
function updateFileContent(data) {
  const container = document.getElementById("content-container");

  if (data.summary.unreachableFiles === 0) {
    container.innerHTML = `
            <div class="success-message">
                <h3>🎉 Excellent! No Dead Code Found</h3>
                <p>All files in your project are reachable from the entry points.</p>
            </div>
        `;
    return;
  }

  container.innerHTML = `
        <div class="detailed-view ${currentView === "detailed" ? "active" : ""}">
            ${generateDetailedView(data)}
        </div>
        <div class="compact-view ${currentView === "compact" ? "active" : ""}">
            ${generateCompactView(data)}
        </div>
    `;

  // Add event listeners
  addFileEventListeners();
  updateSelection();
}

// Generate detailed view HTML
function generateDetailedView(data) {
  const htmlParts = [];

  // False positives first
  if (data.categories["false-positive"].length > 0) {
    htmlParts.push(
      generateFileSection(
        "❌ False Positives",
        data.categories["false-positive"],
        "false-positive",
        true,
      ),
    );
  }

  // Orphaned files
  if (data.categories.orphaned.length > 0) {
    htmlParts.push(
      generateFileSection(
        "🗑️ Orphaned Files",
        data.categories.orphaned,
        "orphaned",
        true,
      ),
    );
  }

  // Transitive dead code
  if (data.categories["transitive-dead-code"].length > 0) {
    htmlParts.push(
      generateFileSection(
        "🔗 Transitive Dead Code",
        data.categories["transitive-dead-code"],
        "transitive",
        true,
      ),
    );
  }

  return htmlParts.join("");
}

// Generate compact view HTML
function generateCompactView(data) {
  const totalDeadFiles =
    data.categories.orphaned.length +
    data.categories["transitive-dead-code"].length;
  const falsePositives = data.categories["false-positive"].length;

  // Calculate additional stats
  const totalSize =
    data.categories.orphaned.length +
    data.categories["transitive-dead-code"].length +
    falsePositives;
  const deletableFiles =
    data.categories.orphaned.length +
    data.categories["transitive-dead-code"].length;

  const html = `
    <div class="compact-header">
      <div class="compact-summary">
        <div class="compact-stats">
          <span class="stat-compact danger">${data.categories.orphaned.length} Orphaned Files</span>
          <span class="stat-compact warning">${data.categories["transitive-dead-code"].length} Transitive Files</span>
          <span class="stat-compact safe">${falsePositives} False Positives</span>
          <span class="stat-compact total">${totalDeadFiles} Total Dead Files</span>
        </div>
        <div class="compact-quick-stats">
          <span class="quick-stat">${deletableFiles} files can be safely deleted</span>
          <span class="quick-stat">${Math.round((deletableFiles / totalSize) * 100)}% cleanup potential</span>
        </div>
      </div>
      
      <div class="compact-controls">
        <div class="compact-view-toggle">
          <button class="compact-toggle-btn active" data-compact-view="list">Grid View</button>
          <button class="compact-toggle-btn" data-compact-view="table">Table View</button>
        </div>
        <div class="compact-actions">
          <button class="compact-btn" onclick="selectAllInCategory('orphaned')">Select Orphaned Files</button>
          <button class="compact-btn" onclick="selectAllInCategory('transitive')">Select Transitive Files</button>
          <input type="text" id="compactSearch" placeholder="Filter files..." class="compact-search">
        </div>
      </div>
    </div>

    <div id="compact-content">
      ${generateCompactListView(data)}
    </div>
  `;

  return html;
}

function generateCompactListView(data) {
  const categories = [
    {
      name: "🗑️ Orphaned Files",
      files: data.categories.orphaned,
      className: "orphaned",
      description: "Not imported by any other file - safest to delete",
      priority: "high",
      color: "#dc3545",
    },
    {
      name: "🔗 Transitive Dead Code",
      files: data.categories["transitive-dead-code"],
      className: "transitive",
      description: "Only used by other dead code - safe to delete",
      priority: "medium",
      color: "#fd7e14",
    },
    {
      name: "❌ False Positives",
      files: data.categories["false-positive"],
      className: "false-positive",
      description: "Marked as not dead code - review before deleting",
      priority: "low",
      color: "#28a745",
    },
  ];

  let html = `<div class="compact-tiles-container">`;

  categories.forEach((category) => {
    if (category.files.length > 0) {
      // Group files by directory path
      const groupedByPath = groupFilesByPath(category.files);

      html += `
        <div class="category-section" data-category="${category.className}">
          <div class="category-section-header">
            <h3 class="category-title ${category.priority}">
              ${category.name} <span class="file-count">(${category.files.length})</span>
            </h3>
            <p class="category-description">${category.description}</p>
            <button class="category-select-all-btn" onclick="selectAllInCategory('${category.className}')" title="Select all ${category.className} files">
              Select All ${category.files.length}
            </button>
          </div>
          <div class="path-tiles-grid">
            ${Object.entries(groupedByPath)
              .map(([path, files]) => {
                const pathDisplayName = getPathDisplayName(path);
                return `
                <div class="path-tile ${category.className}" data-path="${path}">
                  <div class="path-tile-header">
                    <div class="path-info">
                      <h4 class="path-name" title="${path}">${pathDisplayName}</h4>
                      <span class="file-count-badge">${files.length} file${files.length > 1 ? "s" : ""}</span>
                    </div>
                    <div class="path-actions">
                      <button class="path-select-all" onclick="selectAllInPath('${path.replace(/'/g, "\\'")}')" title="Select all files in this directory">
                        Select All
                      </button>
                    </div>
                  </div>
                  <div class="path-tile-files">
                    ${files
                      .map(({ file }) => {
                        const fullFileName = file.split("/").pop();

                        // Handle special cases like .d.ts files
                        let fileName, fileExt;
                        if (fullFileName.endsWith(".d.ts")) {
                          fileName = fullFileName.substring(
                            0,
                            fullFileName.length - 5,
                          );
                          fileExt = "d.ts";
                        } else {
                          const lastDotIndex = fullFileName.lastIndexOf(".");
                          fileName =
                            lastDotIndex > 0
                              ? fullFileName.substring(0, lastDotIndex)
                              : fullFileName;
                          fileExt =
                            lastDotIndex > 0
                              ? fullFileName.substring(lastDotIndex + 1)
                              : "";
                        }

                        // Get appropriate file icon based on extension
                        const getFileIcon = (ext, fullPath = "") => {
                          // Show the actual extension if it exists
                          if (ext && ext.length > 0) {
                            return `.${ext}`;
                          }

                          // Smart inference based on path patterns for modules without extensions
                          if (fullPath) {
                            // React components and pages (likely JSX/TSX)
                            if (
                              fullPath.includes("/components/") ||
                              fullPath.includes("/pages/") ||
                              fullPath.endsWith("Page") ||
                              fullPath.endsWith("Component")
                            ) {
                              return ".tsx";
                            }

                            // Hooks (likely JS/TS)
                            if (
                              fullPath.includes("/hooks/") ||
                              fullPath.includes("use")
                            ) {
                              return ".ts";
                            }

                            // Data, atoms, utils (likely JS/TS)
                            if (
                              fullPath.includes("/data/") ||
                              fullPath.includes("/atoms/") ||
                              fullPath.includes("/utils/") ||
                              fullPath.includes("/services/")
                            ) {
                              return ".ts";
                            }

                            // Themes, styles (likely CSS/SCSS)
                            if (
                              fullPath.includes("/themes/") ||
                              fullPath.includes("/styles/") ||
                              fullPath.includes("theme") ||
                              fullPath.includes("style")
                            ) {
                              return ".ts";
                            }
                          }

                          return ".js";
                        };

                        return `
                        <div class="file-tile ${category.className}" data-file="${file}" data-filename="${fullFileName.toLowerCase()}">
                          <div class="file-tile-content">
                            <div class="file-checkbox-wrapper">
                              <input type="checkbox" class="file-checkbox" data-file="${file}" id="cb-${file.replace(/[^a-zA-Z0-9]/g, "_")}">
                            </div>
                            <div class="file-icon" data-ext="${fileExt.toLowerCase()}">${getFileIcon(fileExt, file)}</div>
                            <div class="file-info">
                              <span class="file-name" title="${file}">${fileName}</span>
                            </div>
                            <div class="file-actions">
                              <button class="file-action-btn view-btn" title="View details" onclick="showFileDetailsModal('${file.replace(/'/g, "\\'")}')">
                                👁️
                              </button>
                              <button class="file-action-btn copy-btn" title="Copy path" onclick="copyToClipboard('${file.replace(/'/g, "\\'")}')">
                                📋
                              </button>
                            </div>
                          </div>
                        </div>
                      `;
                      })
                      .join("")}
                  </div>
                </div>
              `;
              })
              .join("")}
          </div>
        </div>
      `;
    }
  });

  html += `</div>`;
  return html;
}

// Generate compact table view HTML
function generateCompactTableView(data) {
  const categories = [
    {
      name: "🗑️ Orphaned Files",
      files: data.categories.orphaned,
      className: "orphaned",
      description: "Not imported by any other file - safest to delete",
      priority: "high",
    },
    {
      name: "🔗 Transitive Dead Code",
      files: data.categories["transitive-dead-code"],
      className: "transitive",
      description: "Only used by other dead code - safe to delete",
      priority: "medium",
    },
    {
      name: "❌ False Positives",
      files: data.categories["false-positive"],
      className: "false-positive",
      description: "Marked as not dead code - review before deleting",
      priority: "low",
    },
  ];

  let html = `<div class="compact-table-container">`;

  categories.forEach((category) => {
    if (category.files.length > 0) {
      // Get appropriate file icon based on extension
      const getFileIcon = (ext, fullPath = "") => {
        // Show the actual extension if it exists
        if (ext && ext.length > 0) {
          return `.${ext}`;
        }

        // Smart inference based on path patterns for modules without extensions
        if (fullPath) {
          // React components and pages (likely JSX/TSX)
          if (
            fullPath.includes("/components/") ||
            fullPath.includes("/pages/") ||
            fullPath.endsWith("Page") ||
            fullPath.endsWith("Component")
          ) {
            return ".tsx";
          }

          // Hooks (likely JS/TS)
          if (fullPath.includes("/hooks/") || fullPath.includes("use")) {
            return ".ts";
          }

          // Data, atoms, utils (likely JS/TS)
          if (
            fullPath.includes("/data/") ||
            fullPath.includes("/atoms/") ||
            fullPath.includes("/utils/") ||
            fullPath.includes("/services/")
          ) {
            return ".ts";
          }

          // Themes, styles (likely CSS/SCSS)
          if (
            fullPath.includes("/themes/") ||
            fullPath.includes("/styles/") ||
            fullPath.includes("theme") ||
            fullPath.includes("style")
          ) {
            return ".ts";
          }
        }

        return ".js";
      };

      html += `
        <h3 class="compact-table-category ${category.priority}">
          ${category.name} <span class="file-count">(${category.files.length})</span>
        </h3>
        <p class="category-description">${category.description}</p>
        
        <table class="compact-table">
          <thead class="compact-table-header">
            <tr>
              <th style="width: 30px;"></th> <!-- Checkbox column -->
              <th>File</th>
              <th>Path</th>
              <th style="width: 120px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${category.files
              .map(({ file }) => {
                const fullFileName = file.split("/").pop();

                // Handle special cases like .d.ts files
                let fileName, fileExt;
                if (fullFileName.endsWith(".d.ts")) {
                  fileName = fullFileName.substring(0, fullFileName.length - 5);
                  fileExt = "d.ts";
                } else {
                  const lastDotIndex = fullFileName.lastIndexOf(".");
                  fileName =
                    lastDotIndex > 0
                      ? fullFileName.substring(0, lastDotIndex)
                      : fullFileName;
                  fileExt =
                    lastDotIndex > 0
                      ? fullFileName.substring(lastDotIndex + 1)
                      : "";
                }
                const filePath = file.substring(0, file.lastIndexOf("/"));

                return `
                <tr class="compact-table-row ${category.className}" data-file="${file}" data-filename="${fullFileName.toLowerCase()}">
                  <td>
                    <input type="checkbox" class="file-checkbox file-checkbox-table" data-file="${file}" id="tbl-${file.replace(/[^a-zA-Z0-9]/g, "_")}">
                  </td>
                  <td>
                    <div class="file-name-cell">
                      <div class="file-icon-small" data-ext="${fileExt.toLowerCase()}">${getFileIcon(fileExt, file)}</div>
                      <span>${fileName}</span>
                    </div>
                  </td>
                  <td class="file-path-cell">${filePath}</td>
                  <td>
                    <div class="file-action-cell">
                      <button class="table-action-btn view-btn" title="View details" onclick="showFileDetailsModal('${file.replace(/'/g, "\\'")}')">
                        👁️
                      </button>
                      <button class="table-action-btn copy-btn" title="Copy path" onclick="copyToClipboard('${file.replace(/'/g, "\\'")}')">
                        📋
                      </button>
                    </div>
                  </td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
      `;
    }
  });

  html += `</div>`;
  return html;
}

// Optimized table view generation for large file lists
function generateCompactTableViewOptimized(data) {
  const categories = [
    {
      name: "🗑️ Orphaned Files",
      files: data.categories.orphaned,
      className: "orphaned",
      description: "Not imported by any other file - safest to delete",
      priority: "high",
    },
    {
      name: "🔗 Transitive Dead Code",
      files: data.categories["transitive-dead-code"],
      className: "transitive",
      description: "Only used by other dead code - safe to delete",
      priority: "medium",
    },
    {
      name: "❌ False Positives",
      files: data.categories["false-positive"],
      className: "false-positive",
      description: "Marked as not dead code - review before deleting",
      priority: "low",
    },
  ];

  let html = `<div class="compact-table-container">`;

  categories.forEach((category, categoryIndex) => {
    if (category.files.length > 0) {
      const tableId = `table-${category.className}-${Date.now()}`;

      html += `
        <h3 class="compact-table-category ${category.priority}">
          ${category.name} <span class="file-count">(${category.files.length})</span>
        </h3>
        <p class="category-description">${category.description}</p>
        
        <table class="compact-table" id="${tableId}">
          <thead class="compact-table-header">
            <tr>
              <th style="width: 30px;"></th> <!-- Checkbox column -->
              <th>File</th>
              <th>Path</th>
              <th style="width: 120px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="4">
                <div class="loading-files">
                  <div class="loading-spinner"></div>
                  <span>Loading ${category.files.length} files...</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      `;

      // Schedule batch rendering for this category
      setTimeout(() => {
        renderTableRowsBatch(tableId, category);
      }, categoryIndex * 50); // Stagger category rendering
    }
  });

  html += `</div>`;
  return html;
}

// Batch render table rows to prevent UI blocking
function renderTableRowsBatch(tableId, category) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  // Clear loading indicator
  tbody.innerHTML = "";

  const BATCH_SIZE = 15; // Slightly larger batch size for table rows
  let currentIndex = 0;

  // Get appropriate file icon based on extension
  const getFileIcon = (ext, fullPath = "") => {
    // Show the actual extension if it exists
    if (ext && ext.length > 0) {
      return `.${ext}`;
    }

    // Smart inference based on path patterns for modules without extensions
    if (fullPath) {
      // React components and pages (likely JSX/TSX)
      if (
        fullPath.includes("/components/") ||
        fullPath.includes("/pages/") ||
        fullPath.endsWith("Page") ||
        fullPath.endsWith("Component")
      ) {
        return ".tsx";
      }

      // Hooks (likely JS/TS)
      if (fullPath.includes("/hooks/") || fullPath.includes("use")) {
        return ".ts";
      }

      // Data, atoms, utils (likely JS/TS)
      if (
        fullPath.includes("/data/") ||
        fullPath.includes("/atoms/") ||
        fullPath.includes("/utils/") ||
        fullPath.includes("/services/")
      ) {
        return ".ts";
      }

      // Themes, styles (likely CSS/SCSS)
      if (
        fullPath.includes("/themes/") ||
        fullPath.includes("/styles/") ||
        fullPath.includes("theme") ||
        fullPath.includes("style")
      ) {
        return ".ts";
      }
    }

    return ".js";
  };

  function renderNextBatch() {
    const batch = category.files.slice(currentIndex, currentIndex + BATCH_SIZE);

    if (batch.length === 0) {
      // All done, reattach event listeners
      attachFileCheckboxListeners();
      return;
    }

    // Create fragment for better performance
    const fragment = document.createDocumentFragment();

    batch.forEach(({ file }) => {
      const fullFileName = file.split("/").pop();

      // Handle special cases like .d.ts files
      let fileName, fileExt;
      if (fullFileName.endsWith(".d.ts")) {
        fileName = fullFileName.substring(0, fullFileName.length - 5);
        fileExt = "d.ts";
      } else {
        const lastDotIndex = fullFileName.lastIndexOf(".");
        fileName =
          lastDotIndex > 0
            ? fullFileName.substring(0, lastDotIndex)
            : fullFileName;
        fileExt =
          lastDotIndex > 0 ? fullFileName.substring(lastDotIndex + 1) : "";
      }
      const filePath = file.substring(0, file.lastIndexOf("/"));

      const row = document.createElement("tr");
      row.className = `compact-table-row ${category.className}`;
      row.setAttribute("data-file", file);
      row.setAttribute("data-filename", fullFileName.toLowerCase());

      row.innerHTML = `
        <td>
          <input type="checkbox" class="file-checkbox file-checkbox-table" data-file="${file}" id="tbl-${file.replace(/[^a-zA-Z0-9]/g, "_")}">
        </td>
        <td>
          <div class="file-name-cell">
            <div class="file-icon-small" data-ext="${fileExt.toLowerCase()}">${getFileIcon(fileExt, file)}</div>
            <span>${fileName}</span>
          </div>
        </td>
        <td class="file-path-cell">${filePath}</td>
        <td>
          <div class="file-action-cell">
            <button class="table-action-btn view-btn" title="View details" onclick="showFileDetailsModal('${file.replace(/'/g, "\\'")}')">
              👁️
            </button>
            <button class="table-action-btn copy-btn" title="Copy path" onclick="copyToClipboard('${file.replace(/'/g, "\\'")}')">
              📋
            </button>
          </div>
        </td>
      `;

      fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
    currentIndex += BATCH_SIZE;

    // Schedule next batch
    requestAnimationFrame(renderNextBatch);
  }

  renderNextBatch();
}

// Generate file section HTML with performance optimization
function generateFileSection(title, files, className, showDetails) {
  // For large file lists, show a loading placeholder first
  if (files.length > 20) {
    return generateFileSectionOptimized(title, files, className, showDetails);
  }

  // Original implementation for smaller lists
  const fileItems = files
    .map(({ file, analysis }) => {
      const chains = analysis?.chains || [];
      const sampleChain = chains.length > 0 ? chains[0] : null;

      return `
            <div class="file-item ${className}">
                <div class="file-header">
                    <input type="checkbox" class="file-checkbox" data-file="${file}" />
                    <span class="file-name">${file}</span>
                    <span class="file-summary">${analysis?.summary || "No analysis"}</span>
                </div>
                ${
                  showDetails && sampleChain
                    ? `
                    <div class="file-details">
                        <strong>Dependency Chain:</strong>
                        <div class="chain-path">${sampleChain.path.join(" ← ")}</div>
                        <div class="chain-info">
                            Root: ${sampleChain.rootFile} 
                            (${sampleChain.isRootReachable ? "reachable" : "unreachable"})
                        </div>
                    </div>
                `
                    : ""
                }
            </div>
        `;
    })
    .join("");

  return `
        <div class="file-section">
            <h3>${title} (${files.length})</h3>
            <div class="file-list">
                ${fileItems}
            </div>
        </div>
    `;
}

// Optimized version for large file lists
function generateFileSectionOptimized(title, files, className, showDetails) {
  const sectionId = `section-${className}-${Date.now()}`;

  // Create initial structure with loading indicator
  const initialHtml = `
    <div class="file-section" id="${sectionId}">
        <h3>${title} (${files.length})</h3>
        <div class="file-list">
            <div class="loading-files">
                <div class="loading-spinner"></div>
                <span>Loading ${files.length} files...</span>
            </div>
        </div>
    </div>
  `;

  // Batch render files after initial render
  setTimeout(() => {
    renderFilesBatch(sectionId, files, className, showDetails);
  }, 10);

  return initialHtml;
}

// Batch render files to prevent UI blocking
function renderFilesBatch(sectionId, files, className, showDetails) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const fileList = section.querySelector(".file-list");
  if (!fileList) return;

  // Clear loading indicator
  fileList.innerHTML = "";

  const BATCH_SIZE = 10;
  let currentIndex = 0;

  function renderNextBatch() {
    const batch = files.slice(currentIndex, currentIndex + BATCH_SIZE);

    if (batch.length === 0) {
      // All done, update event listeners
      addFileEventListeners();
      return;
    }

    const batchHtml = batch
      .map(({ file, analysis }) => {
        const chains = analysis?.chains || [];
        const sampleChain = chains.length > 0 ? chains[0] : null;

        return `
          <div class="file-item ${className}">
              <div class="file-header">
                  <input type="checkbox" class="file-checkbox" data-file="${file}" />
                  <span class="file-name">${file}</span>
                  <span class="file-summary">${analysis?.summary || "No analysis"}</span>
              </div>
              ${
                showDetails && sampleChain
                  ? `
                  <div class="file-details">
                      <strong>Dependency Chain:</strong>
                      <div class="chain-path">${sampleChain.path.join(" ← ")}</div>
                      <div class="chain-info">
                          Root: ${sampleChain.rootFile} 
                          (${sampleChain.isRootReachable ? "reachable" : "unreachable"})
                      </div>
                  </div>
              `
                  : ""
              }
          </div>
        `;
      })
      .join("");

    fileList.insertAdjacentHTML("beforeend", batchHtml);
    currentIndex += BATCH_SIZE;

    // Use requestAnimationFrame for smooth rendering
    requestAnimationFrame(renderNextBatch);
  }

  renderNextBatch();
}

// Add event listeners to file checkboxes
function addFileEventListeners() {
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", updateSelection);
  });

  // Attach compact view specific event listeners
  attachFileCheckboxListeners();
}

// Update selection state
function updateSelection() {
  selectedFiles.clear();
  document.querySelectorAll(".file-checkbox:checked").forEach((checkbox) => {
    selectedFiles.add(checkbox.dataset.file);
  });

  const count = selectedFiles.size;
  document.getElementById("selectedCount").textContent = count;
  document.getElementById("deleteSelectedBtn").disabled = count === 0;
  document.getElementById("generateScriptBtn").disabled = count === 0;
}

// Switch between detailed and compact views
function switchView(view) {
  if (view === currentView) return;

  currentView = view;
  saveViewPreference();

  // Update button states
  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.dataset.view === view) {
      btn.classList.add("active");
    }
  });

  // Update view display
  document
    .querySelectorAll(".detailed-view, .compact-view")
    .forEach((viewEl) => {
      viewEl.classList.remove("active");
    });

  document.querySelector(`.${view}-view`).classList.add("active");
}

// Refresh analysis
async function refreshAnalysis() {
  showLoading(true, "Running analysis...");

  try {
    const response = await fetch("/api/analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetDir: null }), // Use current directory
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    await response.json();
    showNotification("Analysis completed successfully!", "success");

    // Reload the analysis data
    await loadAnalysisData();
  } catch (error) {
    console.error("Error running analysis:", error);
    showNotification("Error running analysis: " + error.message, "error");
  } finally {
    showLoading(false);
  }
}

// Selection functions
function selectAll() {
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    checkbox.checked = true;
  });
  updateSelection();
}

function selectNone() {
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    checkbox.checked = false;
  });
  updateSelection();
}

function selectOrphaned() {
  selectNone();
  document.querySelectorAll(".orphaned .file-checkbox").forEach((checkbox) => {
    checkbox.checked = true;
  });
  updateSelection();
}

function selectTransitive() {
  selectNone();
  document
    .querySelectorAll(".transitive .file-checkbox")
    .forEach((checkbox) => {
      checkbox.checked = true;
    });
  updateSelection();
}

// Select all files in a specific category
function selectAllInCategory(category) {
  const categoryElement = document.querySelector(
    `[data-category="${category}"]`,
  );
  if (!categoryElement) return;

  const checkboxes = categoryElement.querySelectorAll(".file-checkbox");
  checkboxes.forEach((checkbox) => {
    if (!checkbox.checked) {
      checkbox.checked = true;
      const fileName = checkbox.dataset.file;
      selectedFiles.add(fileName);

      // Update visual state
      const fileItem = checkbox.closest(
        ".file-tile, .compact-table-row, .file-item",
      );
      if (fileItem) {
        fileItem.classList.add("selected");
      }
    }
  });

  updateSelectedCount();
  updateDeleteButton();
  showNotification(`Selected all ${category} files`, "success");
}

// Select all files in a specific path/directory
function selectAllInPath(path) {
  const pathElement = document.querySelector(`[data-path="${path}"]`);
  if (!pathElement) return;

  const checkboxes = pathElement.querySelectorAll(".file-checkbox");
  let selectedCount = 0;

  checkboxes.forEach((checkbox) => {
    if (!checkbox.checked) {
      checkbox.checked = true;
      const fileName = checkbox.dataset.file;
      selectedFiles.add(fileName);
      selectedCount++;

      // Update visual state
      const fileItem = checkbox.closest(
        ".file-tile, .compact-table-row, .file-item",
      );
      if (fileItem) {
        fileItem.classList.add("selected");
      }
    }
  });

  updateSelectedCount();
  updateDeleteButton();

  if (selectedCount > 0) {
    showNotification(
      `Selected ${selectedCount} files from ${getPathDisplayName(path)}`,
      "success",
    );
  }
}

// Copy file path to clipboard
function copyToClipboard(filePath) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(filePath)
      .then(() => {
        showNotification(`Copied to clipboard: ${filePath}`, "success");
      })
      .catch((err) => {
        console.error("Failed to copy to clipboard:", err);
        fallbackCopyToClipboard(filePath);
      });
  } else {
    fallbackCopyToClipboard(filePath);
  }
}

// Fallback copy method for older browsers
function fallbackCopyToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand("copy");
    showNotification(`Copied to clipboard: ${text}`, "success");
  } catch (err) {
    console.error("Fallback copy failed:", err);
    showNotification("Failed to copy to clipboard", "error");
  }

  document.body.removeChild(textArea);
}

// Show file details modal
function showFileDetailsModal(filePath) {
  if (!currentAnalysisData || !currentAnalysisData.chainAnalysis) {
    showNotification("No analysis data available", "warning");
    return;
  }

  const analysis = currentAnalysisData.chainAnalysis[filePath];
  if (!analysis) {
    showNotification("No analysis found for this file", "warning");
    return;
  }

  // Create modal HTML
  const modalHtml = `
    <div class="file-details-modal" id="fileDetailsModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>📄 File Analysis Details</h3>
          <button class="modal-close" onclick="closeFileDetailsModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="file-path">
            <strong>File:</strong> <code>${filePath}</code>
          </div>
          <div class="file-summary">
            <strong>Summary:</strong> ${analysis.summary || "No summary available"}
          </div>
          ${
            analysis.chains && analysis.chains.length > 0
              ? `
            <div class="dependency-chains">
              <strong>Dependency Chains:</strong>
              ${analysis.chains
                .map(
                  (chain, index) => `
                <div class="chain-item">
                  <div class="chain-header">Chain ${index + 1}:</div>
                  <div class="chain-path">${chain.path.join(" ← ")}</div>
                  <div class="chain-info">
                    Root: <code>${chain.rootFile}</code> 
                    (${chain.isRootReachable ? "reachable" : "unreachable"})
                  </div>
                </div>
              `,
                )
                .join("")}
            </div>
          `
              : ""
          }
          ${
            analysis.isOrphaned
              ? `
            <div class="orphaned-info">
              <strong>⚠️ Orphaned File:</strong> This file is not imported by any other file.
            </div>
          `
              : ""
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="copyToClipboard('${filePath.replace(/'/g, "\\'")}')">
            📋 Copy Path
          </button>
          <button class="btn btn-primary" onclick="closeFileDetailsModal()">Close</button>
        </div>
      </div>
    </div>
  `;

  // Remove existing modal if any
  const existingModal = document.getElementById("fileDetailsModal");
  if (existingModal) {
    existingModal.remove();
  }

  // Add modal to body
  document.body.insertAdjacentHTML("beforeend", modalHtml);

  // Show modal with animation
  const modal = document.getElementById("fileDetailsModal");
  modal.style.display = "flex";
  setTimeout(() => modal.classList.add("show"), 10);
}

// Close file details modal
function closeFileDetailsModal() {
  const modal = document.getElementById("fileDetailsModal");
  if (modal) {
    modal.classList.remove("show");
    setTimeout(() => modal.remove(), 300);
  }
}

// Select high priority (safe to delete) files automatically
function selectHighPriorityFiles() {
  selectNone(); // Clear current selection

  // Select all orphaned files (highest priority)
  document.querySelectorAll(".orphaned .file-checkbox").forEach((checkbox) => {
    checkbox.checked = true;
    selectedFiles.add(checkbox.dataset.file);
  });

  // Select all transitive dead code files (medium priority)
  document
    .querySelectorAll(".transitive .file-checkbox")
    .forEach((checkbox) => {
      checkbox.checked = true;
      selectedFiles.add(checkbox.dataset.file);
    });

  updateSelectedCount();
  updateDeleteButton();

  const totalSelected = selectedFiles.size;
  showNotification(`Selected ${totalSelected} safe-to-delete files`, "success");
}

// Delete selected files
async function deleteSelected() {
  if (selectedFiles.size === 0) return;

  const fileList = Array.from(selectedFiles);
  const confirmMessage = `Are you sure you want to delete ${fileList.length} files?\n\n${fileList.join("\n")}`;

  if (!confirm(confirmMessage)) return;

  showLoading(true, "Deleting files...");

  try {
    const response = await fetch("/api/delete-files", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filePaths: fileList }),
    });

    const result = await response.json();

    if (response.ok) {
      const successful = result.results.filter((r) => r.success).length;
      const failed = result.results.filter((r) => !r.success).length;

      let message = `Successfully deleted ${successful} files`;
      if (failed > 0) {
        message += `, ${failed} files failed to delete`;
      }

      showNotification(message, successful > 0 ? "success" : "error");

      // Auto-refresh analysis after deletion
      setTimeout(() => {
        refreshAnalysis();
      }, 1000);
    } else {
      throw new Error(result.error || "Failed to delete files");
    }
  } catch (error) {
    console.error("Error deleting files:", error);
    showNotification("Error deleting files: " + error.message, "error");
  } finally {
    showLoading(false);
  }
}

// Generate deletion script
async function generateScript() {
  if (selectedFiles.size === 0) {
    showNotification("Please select files first", "warning");
    return;
  }

  try {
    const response = await fetch("/api/generate-script", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filePaths: Array.from(selectedFiles) }),
    });

    if (response.ok) {
      const script = await response.text();
      downloadFile("delete-dead-code.sh", script);
      showNotification("Deletion script generated and downloaded", "success");
    } else {
      throw new Error("Failed to generate script");
    }
  } catch (error) {
    console.error("Error generating script:", error);
    showNotification("Error generating script: " + error.message, "error");
  }
}

// Show file details in compact view
function showFileDetails(fileName) {
  if (!currentAnalysisData) return;

  // Find the file in the analysis data
  let fileData = null;
  const categories = ["orphaned", "transitive-dead-code", "false-positive"];

  for (const category of categories) {
    const found = currentAnalysisData.unreachableFiles?.find(
      (item) => item.file === fileName || item === fileName,
    );
    if (found) {
      fileData = found;
      break;
    }
  }

  if (!fileData) {
    showNotification(`File details not found for: ${fileName}`, "warning");
    return;
  }

  // Create a simple modal or alert with file details
  const details =
    typeof fileData === "object" && fileData.analysis
      ? `File: ${fileName}\nCategory: ${fileData.analysis.category || "Unknown"}\nChains: ${fileData.analysis.chains?.length || 0}`
      : `File: ${fileName}\nBasic dead code file`;

  alert(details); // Simple implementation - could be enhanced with a proper modal
}

// Utility Functions

// Update selected file count display
function updateSelectedCount() {
  const count = selectedFiles.size;
  const countElement = document.getElementById("selectedCount");
  if (countElement) {
    countElement.textContent = count;
  }
}

// Update delete button state
function updateDeleteButton() {
  const deleteBtn = document.getElementById("deleteSelectedBtn");
  const generateBtn = document.getElementById("generateScriptBtn");
  const count = selectedFiles.size;

  if (deleteBtn) {
    deleteBtn.disabled = count === 0;
  }
  if (generateBtn) {
    generateBtn.disabled = count === 0;
  }
}

// Show notification to user
function showNotification(message, type = "info") {
  // Create notification element
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  // Style the notification
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === "success" ? "#4caf50" : type === "error" ? "#f44336" : type === "warning" ? "#ff9800" : "#2196f3"};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    max-width: 400px;
    font-size: 14px;
    font-weight: 500;
    opacity: 0;
    transform: translateX(100%);
    transition: all 0.3s ease;
  `;

  document.body.appendChild(notification);

  // Animate in
  setTimeout(() => {
    notification.style.opacity = "1";
    notification.style.transform = "translateX(0)";
  }, 100);

  // Auto remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transform = "translateX(100%)";
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Show loading state
function showLoading(show = true, message = "Loading...") {
  let loader = document.getElementById("global-loader");

  if (show) {
    if (!loader) {
      loader = document.createElement("div");
      loader.id = "global-loader";
      loader.innerHTML = `
        <div class="loader-backdrop">
          <div class="loader-content">
            <div class="spinner"></div>
            <div class="loader-message">${message}</div>
          </div>
        </div>
      `;

      loader.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      // Add CSS for spinner
      const style = document.createElement("style");
      style.textContent = `
        .loader-backdrop {
          background: rgba(0, 0, 0, 0.7);
          border-radius: 12px;
          padding: 24px;
          text-align: center;
          color: white;
        }
        
        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid rgba(255, 255, 255, 0.2);
          border-left: 4px solid white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }
        
        .loader-message {
          font-size: 16px;
          font-weight: 500;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);

      document.body.appendChild(loader);
    } else {
      loader.querySelector(".loader-message").textContent = message;
      loader.style.display = "flex";
    }
  } else {
    if (loader) {
      loader.style.display = "none";
    }
  }
}

// Get display name for a file path
function getPathDisplayName(path) {
  if (!path) return "";

  // Remove leading slash if present
  const cleanPath = path.startsWith("/") ? path.substring(1) : path;

  // Split path and take last few segments
  const parts = cleanPath.split("/");
  if (parts.length <= 3) {
    return cleanPath;
  }

  // Show first and last 2 segments with ellipsis
  return `${parts[0]}/.../${parts.slice(-2).join("/")}`;
}

// Group files by their directory path
function groupFilesByPath(files) {
  const grouped = {};

  files.forEach(({ file }) => {
    const lastSlashIndex = file.lastIndexOf("/");
    const dirPath = lastSlashIndex > 0 ? file.substring(0, lastSlashIndex) : "";

    if (!grouped[dirPath]) {
      grouped[dirPath] = [];
    }
    grouped[dirPath].push({ file });
  });

  return grouped;
}

// Download a file with given name and content
function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// Select files by category type
function selectFilesByCategory(category) {
  selectNone();
  document
    .querySelectorAll(`.${category} .file-checkbox`)
    .forEach((checkbox) => {
      checkbox.checked = true;
      selectedFiles.add(checkbox.dataset.file);

      // Update visual state
      const fileItem = checkbox.closest(
        ".file-tile, .compact-table-row, .file-item",
      );
      if (fileItem) {
        fileItem.classList.add("selected");
      }
    });

  updateSelectedCount();
  updateDeleteButton();
}

// Enhanced compact view event handlers
function setupCompactViewEventHandlers() {
  // Add event listeners for view toggle buttons
  document.addEventListener("click", function (e) {
    if (e.target.classList.contains("compact-toggle-btn")) {
      document
        .querySelectorAll(".compact-toggle-btn")
        .forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");

      const viewMode =
        e.target.dataset.compactView ||
        e.target.textContent.toLowerCase().includes("table")
          ? "table"
          : "list";
      toggleCompactView(viewMode);
    }
  });

  // Add search functionality
  document.addEventListener("input", function (e) {
    if (e.target.id === "compactSearch") {
      filterCompactFiles(e.target.value);
    }
  });

  // Restore view preference
  const viewMode = localStorage.getItem("compactViewMode") || "list";
  setTimeout(() => {
    const viewButton = document.querySelector(
      `.compact-toggle-btn[data-compact-view="${viewMode}"]`,
    );
    if (viewButton) {
      viewButton.click();
    }
  }, 100);
}

// Toggle between list and table view in compact mode
function toggleCompactView(viewMode) {
  const compactContent = document.getElementById("compact-content");
  if (!compactContent) return;

  const data = processAnalysisData(currentAnalysisData);

  if (viewMode === "table") {
    // Check if we have a large number of files that need optimization
    const totalFiles =
      (data.categories.orphaned?.length || 0) +
      (data.categories["transitive-dead-code"]?.length || 0) +
      (data.categories["false-positive"]?.length || 0);

    if (totalFiles > 40) {
      // Use optimized version for large file lists
      compactContent.innerHTML = generateCompactTableViewOptimized(data);
    } else {
      // Use original version for smaller lists
      compactContent.innerHTML = generateCompactTableView(data);
      // Reattach event listeners immediately for non-optimized version
      attachFileCheckboxListeners();
    }
  } else {
    // Generate and show list view
    compactContent.innerHTML = generateCompactListView(data);
    // Reattach event listeners immediately for list view
    attachFileCheckboxListeners();
  }

  // Store preference
  localStorage.setItem("compactViewMode", viewMode);
}

// Filter files in compact view based on search term
function filterCompactFiles(searchTerm) {
  const term = searchTerm.toLowerCase().trim();

  // Filter file tiles
  document.querySelectorAll(".file-tile").forEach((tile) => {
    const fileName = tile.dataset.filename || "";
    const filePath = tile.dataset.file || "";
    const isVisible =
      fileName.includes(term) || filePath.toLowerCase().includes(term);

    tile.style.display = isVisible ? "block" : "none";
  });

  // Filter table rows
  document.querySelectorAll(".compact-table-row").forEach((row) => {
    const fileName = row.dataset.filename || "";
    const filePath = row.dataset.file || "";
    const isVisible =
      fileName.includes(term) || filePath.toLowerCase().includes(term);

    row.style.display = isVisible ? "table-row" : "none";
  });

  // Hide/show path sections if all files are hidden
  document.querySelectorAll(".path-tile").forEach((pathTile) => {
    const visibleFiles = pathTile.querySelectorAll(
      '.file-tile[style*="block"], .file-tile:not([style*="none"])',
    );
    pathTile.style.display = visibleFiles.length > 0 ? "block" : "none";
  });

  // Hide/show category sections if all paths are hidden
  document.querySelectorAll(".category-section").forEach((categorySection) => {
    const visiblePaths = categorySection.querySelectorAll(
      '.path-tile[style*="block"], .path-tile:not([style*="none"])',
    );
    const visibleTableRows = categorySection.querySelectorAll(
      '.compact-table-row[style*="table-row"], .compact-table-row:not([style*="none"])',
    );
    categorySection.style.display =
      visiblePaths.length > 0 || visibleTableRows.length > 0 ? "block" : "none";
  });
}
