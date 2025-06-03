// Global variables
const selectedFiles = new Set();
let currentAnalysisData = null;
let currentView = "detailed";
let currentTargetDir = null;

// Target directory history management
const MAX_RECENT_DIRS = 10; // Maximum number of recent directories to store

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  getCurrentTargetDir();
  loadAnalysisData();
  restoreViewPreference();
  updateQuickTargetsDropdown(); // Populate recent directories
  setupEventListeners();
  // setupAutoRefresh(); // Commented out to stop auto-loading
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

    // Save to recent targets
    saveRecentTargetDir(newTargetDir);

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

  // Manage recent directories button
  document
    .getElementById("manageRecentBtn")
    .addEventListener("click", showManageRecentDialog);

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
            ${entryPoints
              .map((ep) => `<div class="entry-point-item">📍 ${ep}</div>`)
              .join("")}
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
        <div class="detailed-view ${
          currentView === "detailed" ? "active" : ""
        }">
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
          <span class="stat-compact danger">${
            data.categories.orphaned.length
          } Orphaned Files</span>
          <span class="stat-compact warning">${
            data.categories["transitive-dead-code"].length
          } Transitive Files</span>
          <span class="stat-compact safe">${falsePositives} False Positives</span>
          <span class="stat-compact total">${totalDeadFiles} Total Dead Files</span>
        </div>
        <div class="compact-quick-stats">
          <span class="quick-stat">${deletableFiles} files can be safely deleted</span>
          <span class="quick-stat">${Math.round(
            (deletableFiles / totalSize) * 100,
          )}% cleanup potential</span>
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
              ${category.name} <span class="file-count">(${
        category.files.length
      })</span>
            </h3>
            <p class="category-description">${category.description}</p>
            <button class="category-select-all-btn" onclick="selectAllInCategory('${
              category.className
            }')" title="Select all ${category.className} files">
              Select All ${category.files.length}
            </button>
          </div>
          <div class="path-tiles-grid">
            ${Object.entries(groupedByPath)
              .map(([path, files]) => {
                const pathDisplayName = getPathDisplayName(path);
                return `
                <div class="path-tile ${
                  category.className
                }" data-path="${path}">
                  <div class="path-tile-header">
                    <div class="path-info">
                      <h4 class="path-name" title="${path}">${pathDisplayName}</h4>
                      <span class="file-count-badge">${files.length} file${
                  files.length > 1 ? "s" : ""
                }</span>
                    </div>
                    <div class="path-actions">
                      <button class="path-select-all" onclick="selectAllInPath('${path.replace(
                        /'/g,
                        "\\'",
                      )}')"" title="Select all files in this directory">
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
                        <div class="file-tile ${
                          category.className
                        }" data-file="${file}" data-filename="${fullFileName.toLowerCase()}">
                          <div class="file-tile-content">
                            <div class="file-checkbox-wrapper">
                              <input type="checkbox" class="file-checkbox" data-file="${file}" id="cb-${file.replace(
                          /[^a-zA-Z0-9]/g,
                          "_",
                        )}">
                            </div>
                            <div class="file-icon" data-ext="${fileExt.toLowerCase()}">${getFileIcon(
                          fileExt,
                          file,
                        )}</div>
                            <div class="file-info">
                              <span class="file-name" title="${file}">${fileName}</span>
                            </div>
                            <div class="file-actions">
                              <button class="file-action-btn view-btn" title="View details" onclick="showFileDetailsModal('${file.replace(
                                /'/g,
                                "\\'",
                              )}')">
                                👁️
                              </button>
                              <button class="file-action-btn copy-btn" title="Copy path" onclick="copyToClipboard('${file.replace(
                                /'/g,
                                "\\'",
                              )}')">
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
          ${category.name} <span class="file-count">(${
        category.files.length
      })</span>
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
                <tr class="compact-table-row ${
                  category.className
                }" data-file="${file}" data-filename="${fullFileName.toLowerCase()}">
                  <td>
                    <input type="checkbox" class="file-checkbox file-checkbox-table" data-file="${file}" id="tbl-${file.replace(
                  /[^a-zA-Z0-9]/g,
                  "_",
                )}">
                  </td>
                  <td>
                    <div class="file-name-cell">
                      <div class="file-icon-small" data-ext="${fileExt.toLowerCase()}">${getFileIcon(
                  fileExt,
                  file,
                )}</div>
                      <span>${fileName}</span>
                    </div>
                  </td>
                  <td class="file-path-cell">${filePath}</td>
                  <td>
                    <div class="file-action-cell">
                      <button class="table-action-btn view-btn" title="View details" onclick="showFileDetailsModal('${file.replace(
                        /'/g,
                        "\\'",
                      )}')">
                        👁️
                      </button>
                      <button class="table-action-btn copy-btn" title="Copy path" onclick="copyToClipboard('${file.replace(
                        /'/g,
                        "\\'",
                      )}')">
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
          <input type="checkbox" class="file-checkbox file-checkbox-table" data-file="${file}" id="tbl-${file.replace(
        /[^a-zA-Z0-9]/g,
        "_",
      )}">
        </td>
        <td>
          <div class="file-name-cell">
            <div class="file-icon-small" data-ext="${fileExt.toLowerCase()}">${getFileIcon(
        fileExt,
        file,
      )}</div>
            <span>${fileName}</span>
          </div>
        </td>
        <td class="file-path-cell">${filePath}</td>
        <td>
          <div class="file-action-cell">
            <button class="table-action-btn view-btn" title="View details" onclick="showFileDetailsModal('${file.replace(
              /'/g,
              "\\'",
            )}')">
              👁️
            </button>
            <button class="table-action-btn copy-btn" title="Copy path" onclick="copyToClipboard('${file.replace(
              /'/g,
              "\\'",
            )}')">
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
                    <span class="file-summary">${
                      analysis?.summary || "No analysis"
                    }</span>
                </div>
                ${
                  showDetails && sampleChain
                    ? `
                    <div class="file-details">
                        <strong>Dependency Chain:</strong>
                        <div class="chain-path">${sampleChain.path.join(
                          " ← ",
                        )}</div>
                        <div class="chain-info">
                            Root: ${sampleChain.rootFile} 
                            (${
                              sampleChain.isRootReachable
                                ? "reachable"
                                : "unreachable"
                            })
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
                  <span class="file-summary">${
                    analysis?.summary || "No analysis"
                  }</span>
              </div>
              ${
                showDetails && sampleChain
                  ? `
                  <div class="file-details">
                      <strong>Dependency Chain:</strong>
                      <div class="chain-path">${sampleChain.path.join(
                        " ← ",
                      )}</div>
                      <div class="chain-info">
                          Root: ${sampleChain.rootFile} 
                          (${
                            sampleChain.isRootReachable
                              ? "reachable"
                              : "unreachable"
                          })
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

// Show manage recent directories dialog
function showManageRecentDialog() {
  const recent = getRecentTargetDirs();
  const modal = document.getElementById("recentDirsModal");
  const recentDirsList = document.getElementById("recentDirsList");

  if (recent.length === 0) {
    recentDirsList.innerHTML = `
      <div class="empty-recent">
        <p>No recent target directories found</p>
        <p>Start analyzing some projects to build your recent list!</p>
      </div>
    `;
  } else {
    recentDirsList.innerHTML = recent
      .map(
        (dir) => `
      <div class="recent-dir-item">
        <div class="recent-dir-info">
          <div class="recent-dir-name">${dir.displayName}</div>
          <div class="recent-dir-path">${dir.path}</div>
          <div class="recent-dir-date">Last used: ${new Date(
            dir.lastUsed,
          ).toLocaleString()}</div>
        </div>
        <div class="recent-dir-actions">
          <button class="recent-dir-btn use" onclick="useRecentDir('${dir.path.replace(
            /'/g,
            "\\'",
          )}')">
            Use
          </button>
          <button class="recent-dir-btn remove" onclick="removeRecentDir('${dir.path.replace(
            /'/g,
            "\\'",
          )}')">
            Remove
          </button>
        </div>
      </div>
    `,
      )
      .join("");
  }

  modal.style.display = "flex";
}

// Get recent target directories from localStorage
function getRecentTargetDirs() {
  try {
    const recent = localStorage.getItem("deadCodeAnalyzer.recentTargetDirs");
    return recent ? JSON.parse(recent) : [];
  } catch (error) {
    console.error("Error loading recent target directories:", error);
    return [];
  }
}

// Save a target directory to recent list
function saveRecentTargetDir(targetDir) {
  try {
    let recent = getRecentTargetDirs();

    // Remove if already exists (to move to top)
    recent = recent.filter((dir) => dir.path !== targetDir);

    // Add to beginning
    recent.unshift({
      path: targetDir,
      lastUsed: new Date().toISOString(),
      displayName: getDisplayNameForPath(targetDir),
    });

    // Keep only the most recent entries
    recent = recent.slice(0, MAX_RECENT_DIRS);

    localStorage.setItem(
      "deadCodeAnalyzer.recentTargetDirs",
      JSON.stringify(recent),
    );

    // Update the dropdown
    updateQuickTargetsDropdown();
  } catch (error) {
    console.error("Error saving recent target directory:", error);
  }
}

// Remove a target directory from recent list
function removeRecentTargetDir(targetDir) {
  try {
    let recent = getRecentTargetDirs();
    recent = recent.filter((dir) => dir.path !== targetDir);
    localStorage.setItem(
      "deadCodeAnalyzer.recentTargetDirs",
      JSON.stringify(recent),
    );
    updateQuickTargetsDropdown();
  } catch (error) {
    console.error("Error removing recent target directory:", error);
  }
}

// Get a friendly display name for a path
function getDisplayNameForPath(fullPath) {
  const parts = fullPath.split("/");
  if (parts.length <= 2) return fullPath;

  // Show last 2-3 directory segments for readability
  const lastParts = parts.slice(-3);
  return `.../${lastParts.join("/")}`;
}

// Update the quick targets dropdown with recent directories
function updateQuickTargetsDropdown() {
  const dropdown = document.getElementById("quickTargets");
  if (!dropdown) return;

  const recent = getRecentTargetDirs();

  // Clear existing options except the first one
  dropdown.innerHTML = '<option value="">-- Quick Select --</option>';

  // Add recent directories section
  if (recent.length > 0) {
    const recentGroup = document.createElement("optgroup");
    recentGroup.label = `📅 Recent (${recent.length})`;

    recent.forEach((dir, index) => {
      const option = document.createElement("option");
      option.value = dir.path;
      option.textContent = `${dir.displayName}`;
      option.title = `${dir.path}\nLast used: ${new Date(
        dir.lastUsed,
      ).toLocaleString()}`; // Full path and timestamp on hover
      recentGroup.appendChild(option);
    });

    dropdown.appendChild(recentGroup);
  }

  // Add predefined common directories
  const commonGroup = document.createElement("optgroup");
  commonGroup.label = "🚀 Common Projects";

  const commonDirs = [
    {
      path: "/Users/barryvelasquez/projects/mighty45-web/apps/coach-console",
      name: "coach-console",
    },
    {
      path: "/Users/barryvelasquez/projects/mighty45-web/apps/m45-admin",
      name: "m45-admin",
    },
    {
      path: "/Users/barryvelasquez/projects/mighty45-web",
      name: "entire project",
    },
  ];

  commonDirs.forEach((dir) => {
    const option = document.createElement("option");
    option.value = dir.path;
    option.textContent = dir.name;
    commonGroup.appendChild(option);
  });

  dropdown.appendChild(commonGroup);
}

// Clear recent target directories (for user management)
function clearRecentTargetDirs() {
  try {
    localStorage.removeItem("deadCodeAnalyzer.recentTargetDirs");
    updateQuickTargetsDropdown();
    showNotification("Recent target directories cleared", "success");
  } catch (error) {
    console.error("Error clearing recent target directories:", error);
    showNotification("Error clearing recent directories", "error");
  }
}

// Close the recent directories modal
function closeRecentDirsModal() {
  const modal = document.getElementById("recentDirsModal");
  modal.style.display = "none";
}

// Use a recent directory (set it as current target)
function useRecentDir(dirPath) {
  document.getElementById("targetDir").value = dirPath;
  closeRecentDirsModal();
  showNotification(
    `Set target directory to: ${getDisplayNameForPath(dirPath)}`,
    "info",
  );
}

// Remove a recent directory from the list
function removeRecentDir(dirPath) {
  if (
    confirm(
      `Remove "${getDisplayNameForPath(dirPath)}" from recent directories?`,
    )
  ) {
    removeRecentTargetDir(dirPath);
    showNotification(`Removed from recent directories`, "success");
    // Refresh the modal content
    showManageRecentDialog();
  }
}

// Clear all recent directories
function clearAllRecentDirs() {
  if (
    confirm("Are you sure you want to clear all recent target directories?")
  ) {
    clearRecentTargetDirs();
    closeRecentDirsModal();
  }
}

// Loading indicator functions
function showLoading(show, message = "Loading...") {
  const loadingIndicator = document.getElementById("loadingIndicator");
  const loadingText = document.getElementById("loadingText");

  if (show) {
    if (loadingText) {
      loadingText.textContent = message;
    }
    if (loadingIndicator) {
      loadingIndicator.style.display = "flex";
    }
  } else {
    if (loadingIndicator) {
      loadingIndicator.style.display = "none";
    }
  }
}

// Notification functions
function showNotification(message, type = "info") {
  const notification = document.getElementById("notification");
  if (!notification) return;

  notification.textContent = message;
  notification.className = `notification ${type}`;
  notification.classList.add("show");

  // Auto-hide after 3 seconds
  setTimeout(() => {
    notification.classList.remove("show");
  }, 3000);
}

// Refresh analysis
async function refreshAnalysis() {
  await loadAnalysisData();
}

// File selection functions
function selectAll() {
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    if (!checkbox.disabled) {
      checkbox.checked = true;
      selectedFiles.add(checkbox.dataset.file);
    }
  });
  updateSelection();
  updateSelectedCount();
  updateDeleteButton();
}

function selectNone() {
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    checkbox.checked = false;
  });
  selectedFiles.clear();
  updateSelection();
  updateSelectedCount();
  updateDeleteButton();
}

function selectOrphaned() {
  selectNone();
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    const fileItem = checkbox.closest(
      ".file-item, .file-tile, .compact-table-row",
    );
    if (fileItem && fileItem.classList.contains("orphaned")) {
      checkbox.checked = true;
      selectedFiles.add(checkbox.dataset.file);
    }
  });
  updateSelection();
  updateSelectedCount();
  updateDeleteButton();
}

function selectTransitive() {
  selectNone();
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    const fileItem = checkbox.closest(
      ".file-item, .file-tile, .compact-table-row",
    );
    if (fileItem && fileItem.classList.contains("transitive")) {
      checkbox.checked = true;
      selectedFiles.add(checkbox.dataset.file);
    }
  });
  updateSelection();
  updateSelectedCount();
  updateDeleteButton();
}

// Delete selected files
async function deleteSelected() {
  if (selectedFiles.size === 0) {
    showNotification("No files selected for deletion", "warning");
    return;
  }

  const fileList = Array.from(selectedFiles);
  const confirmMessage = `Are you sure you want to delete ${
    fileList.length
  } file(s)?\n\n${fileList.slice(0, 5).join("\n")}${
    fileList.length > 5 ? "\n... and " + (fileList.length - 5) + " more" : ""
  }`;

  if (!confirm(confirmMessage)) {
    return;
  }

  showLoading(true, "Deleting selected files...");

  try {
    const response = await fetch("/api/delete-files", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filePaths: fileList }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    const successfulDeletes = result.results.filter((r) => r.success).length;
    const failedDeletes = result.results.filter((r) => !r.success);

    if (successfulDeletes > 0) {
      showNotification(
        `Successfully deleted ${successfulDeletes} file(s)`,
        "success",
      );
    }

    if (failedDeletes.length > 0) {
      console.warn("Some files failed to delete:", failedDeletes);

      // Create a detailed error message
      const errorDetails = failedDeletes
        .map((f) => `• ${f.file}: ${f.error}`)
        .join("\n");

      showNotification(
        `Warning: ${failedDeletes.length} file(s) could not be deleted. Check console for details.`,
        "warning",
      );

      // Also log detailed information for debugging
      console.group("Files that could not be deleted:");
      failedDeletes.forEach((failure) => {
        console.log(`File: ${failure.file}`);
        console.log(`Error: ${failure.error}`);
        console.log("---");
      });
      console.groupEnd();
    }

    // Clear selection and refresh analysis
    selectedFiles.clear();
    await loadAnalysisData();
  } catch (error) {
    console.error("Error deleting files:", error);
    showNotification(`Failed to delete files: ${error.message}`, "error");
  } finally {
    showLoading(false);
  }
}

// Generate deletion script
function generateScript() {
  if (selectedFiles.size === 0) {
    showNotification("No files selected for script generation", "warning");
    return;
  }

  const fileList = Array.from(selectedFiles);
  const script = fileList.map((file) => `rm "${file}"`).join("\n");

  // Create and download script file
  const blob = new Blob([script], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "delete_dead_code.sh";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification(`Generated script for ${fileList.length} files`, "success");
}

// View switching
function switchView(view) {
  if (!["detailed", "compact"].includes(view)) return;

  currentView = view;
  saveViewPreference();

  // Update button states
  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.dataset.view === view) {
      btn.classList.add("active");
    }
  });

  // Update content visibility
  const detailedView = document.querySelector(".detailed-view");
  const compactView = document.querySelector(".compact-view");

  if (detailedView && compactView) {
    if (view === "detailed") {
      detailedView.classList.add("active");
      compactView.classList.remove("active");
    } else {
      detailedView.classList.remove("active");
      compactView.classList.add("active");
    }
  }
}

// Add event listeners to file elements
function addFileEventListeners() {
  attachFileCheckboxListeners();
}

// Update selection states
function updateSelection() {
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    const fileName = checkbox.dataset.file;
    const fileItem = checkbox.closest(
      ".file-item, .file-tile, .compact-table-row",
    );

    if (selectedFiles.has(fileName)) {
      checkbox.checked = true;
      if (fileItem) {
        fileItem.classList.add("selected");
      }
    } else {
      checkbox.checked = false;
      if (fileItem) {
        fileItem.classList.remove("selected");
      }
    }
  });
}

// Update selected count display
function updateSelectedCount() {
  const selectedCountElement = document.getElementById("selectedCount");
  if (selectedCountElement) {
    selectedCountElement.textContent = selectedFiles.size;
  }
}

// Update delete button state
function updateDeleteButton() {
  const deleteBtn = document.getElementById("deleteSelectedBtn");
  const generateBtn = document.getElementById("generateScriptBtn");

  if (deleteBtn) {
    deleteBtn.disabled = selectedFiles.size === 0;
  }
  if (generateBtn) {
    generateBtn.disabled = selectedFiles.size === 0;
  }
}

// Setup compact view event handlers
function setupCompactViewEventHandlers() {
  // Compact view toggle buttons
  document.addEventListener("click", function (e) {
    if (e.target.classList.contains("compact-toggle-btn")) {
      const view = e.target.dataset.compactView;
      switchCompactView(view);
    }
  });

  // Search functionality
  const searchInput = document.getElementById("compactSearch");
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      filterFiles(this.value);
    });
  }
}

// Switch compact view layout
function switchCompactView(view) {
  const listView = document.querySelector(".compact-tiles-container");
  const tableView = document.querySelector(".compact-table-container");

  document.querySelectorAll(".compact-toggle-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.dataset.compactView === view) {
      btn.classList.add("active");
    }
  });

  if (view === "table") {
    if (listView) listView.style.display = "none";
    if (tableView) tableView.style.display = "block";
  } else {
    if (listView) listView.style.display = "block";
    if (tableView) tableView.style.display = "none";
  }
}

// Filter files based on search
function filterFiles(searchTerm) {
  const term = searchTerm.toLowerCase();
  document
    .querySelectorAll(".file-tile, .compact-table-row")
    .forEach((element) => {
      const fileName = element.dataset.filename || element.dataset.file || "";
      const visible = fileName.toLowerCase().includes(term);
      element.style.display = visible ? "" : "none";
    });
}

// Utility functions for file operations
function copyToClipboard(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      showNotification("Copied to clipboard", "success");
    })
    .catch((err) => {
      console.error("Failed to copy:", err);
      showNotification("Failed to copy to clipboard", "error");
    });
}

function showFileDetailsModal(filePath) {
  if (!currentAnalysisData || !currentAnalysisData.chainAnalysis) {
    showNotification("No analysis data available", "warning");
    return;
  }

  const analysis = currentAnalysisData.chainAnalysis[filePath];
  if (!analysis) {
    showNotification("No analysis data for this file", "warning");
    return;
  }

  const modalContent = `
    <div style="background: white; padding: 20px; border-radius: 8px; max-width: 600px; max-height: 80vh; overflow: auto;">
      <h3>File Details: ${filePath}</h3>
      <p><strong>Summary:</strong> ${
        analysis.summary || "No summary available"
      }</p>
      <p><strong>Is Orphaned:</strong> ${analysis.isOrphaned ? "Yes" : "No"}</p>
      ${
        analysis.chains && analysis.chains.length > 0
          ? `
        <h4>Dependency Chains:</h4>
        <ul>
          ${analysis.chains
            .map(
              (chain) => `
            <li>
              <strong>Path:</strong> ${chain.path.join(" ← ")}<br>
              <strong>Root:</strong> ${chain.rootFile} (${
                chain.isRootReachable ? "reachable" : "unreachable"
              })
            </li>
          `,
            )
            .join("")}
        </ul>
      `
          : "<p>No dependency chains found.</p>"
      }
      <button onclick="this.parentElement.parentElement.remove()" style="margin-top: 10px; padding: 5px 10px;">Close</button>
    </div>
  `;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;";
  overlay.innerHTML = modalContent;
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}

// Category selection functions
function selectAllInCategory(categoryClass) {
  document
    .querySelectorAll(`.${categoryClass} .file-checkbox`)
    .forEach((checkbox) => {
      if (!checkbox.disabled) {
        checkbox.checked = true;
        selectedFiles.add(checkbox.dataset.file);
      }
    });
  updateSelection();
  updateSelectedCount();
  updateDeleteButton();
}

function selectAllInPath(path) {
  document
    .querySelectorAll(`[data-path="${path}"] .file-checkbox`)
    .forEach((checkbox) => {
      if (!checkbox.disabled) {
        checkbox.checked = true;
        selectedFiles.add(checkbox.dataset.file);
      }
    });
  updateSelection();
  updateSelectedCount();
  updateDeleteButton();
}

// File grouping utilities
function groupFilesByPath(files) {
  const grouped = {};
  files.forEach(({ file }) => {
    const path = file.substring(0, file.lastIndexOf("/")) || ".";
    if (!grouped[path]) {
      grouped[path] = [];
    }
    grouped[path].push({ file });
  });
  return grouped;
}

function getPathDisplayName(path) {
  if (path === ".") return "Root";
  const parts = path.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
}

function getFileIcon(ext, filePath) {
  const extension = ext.toLowerCase();
  const fileName = filePath.toLowerCase();

  // Common file type icons
  if (["js", "jsx"].includes(extension)) return "📄";
  if (["ts", "tsx"].includes(extension)) return "📘";
  if (["css", "scss", "sass"].includes(extension)) return "🎨";
  if (["html", "htm"].includes(extension)) return "🌐";
  if (["json"].includes(extension)) return "📋";
  if (["md", "markdown"].includes(extension)) return "📝";
  if (["png", "jpg", "jpeg", "gif", "svg"].includes(extension)) return "🖼️";
  if (["test", "spec"].some((t) => fileName.includes(t))) return "🧪";
  if (fileName.includes("hook")) return "🪝";
  if (fileName.includes("component")) return "🧩";
  if (fileName.includes("util")) return "🔧";

  return "📄"; // Default icon
}

// Close modal when clicking outside of it
window.addEventListener("click", function (event) {
  const modal = document.getElementById("recentDirsModal");
  if (event.target === modal) {
    closeRecentDirsModal();
  }
});

// Close modal with Escape key
window.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    const modal = document.getElementById("recentDirsModal");
    if (modal.style.display === "flex") {
      closeRecentDirsModal();
    }
  }
});
