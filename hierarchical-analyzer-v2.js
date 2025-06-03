#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Parse command line arguments
const targetDir = process.argv[2] || process.cwd();
const outputFile = process.argv[3] || "hierarchical-analysis-results.json";
const traceFile = process.argv[4]; // Optional: specific file to trace

// Change to target directory if specified
if (targetDir !== process.cwd()) {
  process.chdir(targetDir);
  console.log(`Changed working directory to: ${targetDir}`);
}

// Colors for output
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  purple: "\x1b[35m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};

// Track files with dynamic imports
let filesWithDynamicImports = [];

console.log(`${colors.blue}🔗 Hierarchical Dead Code Analysis${colors.reset}`);
console.log(`${colors.blue}Target Directory: ${targetDir}${colors.reset}`);
console.log(
  `${colors.blue}===================================${colors.reset}\n`,
);

// Function to find all JS/TS files (excluding test files)
function findSourceFiles() {
  try {
    // List of folders to ignore (add more as needed)
    const ignoreDirs = ["node_modules", "dist", ".git", "build"];
    // Build the prune part of the find command
    const prune = ignoreDirs
      .map((dir) => `-path './${dir}' -prune`)
      .join(" -o ");
    // Compose the find command
    const findCmd =
      `find . ` +
      (prune ? `\\( ${prune} \\) -o ` : "") +
      `-type f \\( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' \\) -print`;
    const output = execSync(findCmd, { encoding: "utf8" });
    const allFiles = output
      .trim()
      .split("\n")
      .filter((file) => file)
      .map((file) => file.replace(/^\.\//, ""));

    const sourceFiles = allFiles.filter((file) => {
      // Exclude test files and directories
      return (
        !file.includes("__tests__") &&
        !file.includes(".test.") &&
        !file.includes(".spec.") &&
        !file.includes(".stories.") &&
        !file.includes("setupTests") &&
        !file.endsWith(".d.ts") &&
        !file.includes(".config.")
      );
    });

    const excludedFiles = allFiles.filter(
      (file) => !sourceFiles.includes(file),
    );
    if (excludedFiles.length > 0) {
      console.log(
        `${colors.cyan}📝 Excluded ${excludedFiles.length} test/story/config/type definition files from analysis${colors.reset}`,
      );
    }

    return sourceFiles;
  } catch (error) {
    console.error("Error finding source files:", error.message);
    return [];
  }
}

// Function to extract re-exports from barrel files (index.js)
function extractReExports(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const reExports = [];

    // Match export patterns that re-export from other files
    const exportPatterns = [
      /export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g, // export { Component } from "./Component"
      /export\s+\*\s+from\s+['"]([^'"]+)['"]/g, // export * from "./Component"
      /export\s+\{\s*default\s+as\s+\w+\s*\}\s+from\s+['"]([^'"]+)['"]/g, // export { default as Component } from "./Component"
      /export\s+type\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g, // export type { TypeName } from "./module"
    ];

    exportPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const exportPath = match[1];
        // Only process relative imports
        if (exportPath.startsWith(".")) {
          // Resolve relative path
          const dir = path.dirname(filePath);
          const resolvedPath = path.normalize(path.join(dir, exportPath));
          // Remove extension if present
          const cleanPath = resolvedPath.replace(/\.(js|jsx|ts|tsx)$/, "");
          reExports.push(cleanPath);
        }
      }
    });

    return [...new Set(reExports)]; // Remove duplicates
  } catch (error) {
    return [];
  }
}

// Function to extract imports from a file
function extractImports(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const imports = [];

    // Match various import patterns (including multi-line imports)
    const importPatterns = [
      /import\s+[^;]+\s+from\s+['"]([^'"]+)['"];?/gs, // Multi-line imports with global and dotAll flags
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    // Check for potential dynamic import patterns that we can't resolve statically
    const dynamicImportPatterns = [
      /import\s*\(\s*`[^`]*`\s*\)/g, // Template literals in imports: import(`./path/${var}`)
      /import\s*\(\s*[^"'`]\s*[^)]*\)/g, // Variable imports: import(path)
      /import\s*\(\s*.*?\s*\+\s*.*?\s*\)/g, // String concatenation: import("./path" + variable)
    ];

    importPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const importPath = match[1];
        // Only process relative imports
        if (importPath.startsWith(".")) {
          // Resolve relative path
          const dir = path.dirname(filePath);
          let resolvedPath = path.normalize(path.join(dir, importPath));
          // Remove extension if present, we'll check for multiple extensions
          resolvedPath = resolvedPath.replace(/\.(js|jsx|ts|tsx)$/, "");
          imports.push(resolvedPath);
        }
      }
    });

    // Check for potential dynamic imports that static analysis can't resolve
    let hasDynamicImports = false;
    dynamicImportPatterns.forEach((pattern) => {
      if (pattern.test(content)) {
        hasDynamicImports = true;
      }
    });

    if (hasDynamicImports) {
      console.log(
        `${colors.yellow}⚠️  Warning: ${filePath} contains dynamic imports that cannot be statically analyzed${colors.reset}`,
      );
      // Store this file in a separate list for reporting
      if (!filesWithDynamicImports) {
        filesWithDynamicImports = [];
      }
      filesWithDynamicImports.push(filePath);
    }

    return [...new Set(imports)]; // Remove duplicates
  } catch (error) {
    return [];
  }
}

// Function to find entry points
function findEntryPoints() {
  const entryPoints = [];

  // List of folders to ignore (should match findSourceFiles)
  const ignoreDirs = ["node_modules", "dist", ".git", "build"];

  // Common entry point base names
  const baseNames = ["index", "App", "main", "server", "app"];
  // All JS/TS extensions
  const extensions = [".js", ".jsx", ".ts", ".tsx"];

  // Build the prune part for find
  const prune = ignoreDirs.map((dir) => `-path './${dir}' -prune`).join(" -o ");

  // For each base name and extension, search for files
  baseNames.forEach((base) => {
    extensions.forEach((ext) => {
      try {
        const pattern = `${base}${ext}`;
        const findCmd =
          `find . ` +
          (prune ? `\\( ${prune} \\) -o ` : "") +
          `-type f -name '${pattern}' -print`;
        const output = execSync(findCmd, { encoding: "utf8" });
        const files = output
          .trim()
          .split("\n")
          .filter((file) => file && file.startsWith("./"));
        files.forEach((file) => {
          entryPoints.push(
            file.replace(/^\.\//, "").replace(/\.(js|jsx|ts|tsx)$/, ""),
          );
        });
      } catch (error) {
        // Pattern not found, continue
      }
    });
  });

  // Also look for common API/server patterns
  const apiPatterns = ["api", "routes", "router", "middleware"];
  apiPatterns.forEach((pattern) => {
    try {
      const findCmd =
        `find . ` +
        (prune ? `\\( ${prune} \\) -o ` : "") +
        `-type f -path '*/api/*' -name '*.js' -print -o -path '*/routes/*' -name '*.js' -print`;
      const output = execSync(findCmd, { encoding: "utf8" });
      const files = output
        .trim()
        .split("\n")
        .filter((file) => file && file.startsWith("./"));
      files.forEach((file) => {
        entryPoints.push(
          file.replace(/^\.\//, "").replace(/\.(js|jsx|ts|tsx)$/, ""),
        );
      });
    } catch (error) {
      // Pattern not found, continue
    }
  });

  // Add files that might be entry points (referenced in package.json, etc.)
  try {
    if (fs.existsSync("package.json")) {
      const packageContent = fs.readFileSync("package.json", "utf8");
      const packageJson = JSON.parse(packageContent);
      if (packageJson.main) {
        const mainFile = packageJson.main
          .replace(/^\.\//, "")
          .replace(/\.(js|jsx|ts|tsx)$/, "");
        entryPoints.push(mainFile);
      }
    }
  } catch (error) {
    // Ignore package.json errors
  }

  return [...new Set(entryPoints)];
}

// Function to normalize file names for matching
function normalizeFileName(fileName) {
  return fileName.replace(/\.(js|jsx|ts|tsx)$/, "");
}

// Function to check if a dependency exists with any extension
function findActualFile(depPath, allFiles) {
  const extensions = [
    "",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    "/index", // Changed: check for normalized index files
    "/index.js",
    "/index.jsx",
    "/index.ts",
    "/index.tsx",
  ];

  for (const ext of extensions) {
    const candidate = depPath + ext;
    if (allFiles.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Function to build reverse dependency map (who imports what)
function buildReverseDependencies(dependencies) {
  const reverseDeps = {};

  Object.keys(dependencies).forEach((file) => {
    dependencies[file].forEach((dep) => {
      if (!reverseDeps[dep]) {
        reverseDeps[dep] = [];
      }
      reverseDeps[dep].push(file);
    });
  });

  return reverseDeps;
}

// Function to trace dependency chain from a file to entry points
function traceDependencyChain(
  file,
  reverseDeps,
  visited = new Set(),
  chain = [],
) {
  if (visited.has(file)) {
    return []; // Circular dependency or already processed
  }

  visited.add(file);
  const currentChain = [...chain, file];

  const importers = reverseDeps[file] || [];
  if (importers.length === 0) {
    // This is a root file (no one imports it)
    return [currentChain];
  }

  const allChains = [];
  importers.forEach((importer) => {
    const chains = traceDependencyChain(
      importer,
      reverseDeps,
      new Set(visited),
      currentChain,
    );
    allChains.push(...chains);
  });

  return allChains;
}

// Function to analyze hierarchical chains for unreachable files
function analyzeHierarchicalChains(
  unreachableFiles,
  dependencies,
  reachableFiles,
) {
  const reverseDeps = buildReverseDependencies(dependencies);
  const reachableSet = new Set(reachableFiles);
  const chainAnalysis = {};

  unreachableFiles.forEach((file) => {
    const chains = traceDependencyChain(file, reverseDeps);

    // Analyze each chain
    const chainInfo = {
      file: file,
      isOrphaned:
        chains.length === 0 || (chains.length === 1 && chains[0].length === 1),
      chains: chains.map((chain) => {
        const rootFile = chain[chain.length - 1];
        const isRootReachable = reachableSet.has(rootFile);

        return {
          path: chain,
          rootFile: rootFile,
          isRootReachable: isRootReachable,
          chainLength: chain.length,
          reason: isRootReachable
            ? "Root is reachable (potential bug in analysis)"
            : chain.length === 1
            ? "Orphaned file"
            : "Entire chain unreachable",
        };
      }),
      importedBy: reverseDeps[file] || [],
      summary: "",
    };

    // Generate summary
    if (chainInfo.isOrphaned) {
      chainInfo.summary = "Orphaned - not imported by any file";
    } else {
      const reachableChains = chainInfo.chains.filter((c) => c.isRootReachable);
      const unreachableChains = chainInfo.chains.filter(
        (c) => !c.isRootReachable,
      );

      if (reachableChains.length > 0) {
        chainInfo.summary = `FALSE POSITIVE - ${reachableChains.length} chain(s) lead to reachable code`;
      } else if (unreachableChains.length > 0) {
        const maxLength = Math.max(
          ...unreachableChains.map((c) => c.chainLength),
        );
        chainInfo.summary = `Transitive dead code - ${unreachableChains.length} chain(s), max depth ${maxLength}`;
      }
    }

    chainAnalysis[file] = chainInfo;
  });

  return chainAnalysis;
}

// Main analysis function
function analyzeHierarchical() {
  console.log(`${colors.purple}Step 1: Finding source files...${colors.reset}`);
  const allFiles = findSourceFiles();
  console.log(`Found ${allFiles.length} source files`);

  console.log(
    `\n${colors.purple}Step 2: Building dependency graph...${colors.reset}`,
  );
  const dependencies = {};
  let barrelExportsFound = 0;
  let additionalDependenciesFromBarrels = 0;

  allFiles.forEach((file) => {
    const normalizedFile = normalizeFileName(file);
    const imports = extractImports(file);

    // Start with direct imports
    const allDependencies = [...imports];

    // Check if any of these imports resolve to barrel files (index.js)
    // and if so, add their re-exports as additional dependencies
    imports.forEach((importPath) => {
      const actualFile = findActualFile(
        importPath,
        allFiles.map((f) => normalizeFileName(f)),
      );

      // If the import resolves to an index file, it's likely a barrel export
      if (actualFile && actualFile.includes("/index")) {
        // For reading the file, we need to add the extension back
        // Try multiple extensions for TypeScript projects
        let fileToRead = null;
        const extensions = [".ts", ".tsx", ".js", ".jsx"];

        if (actualFile.endsWith("/index")) {
          // Try each extension until we find the file
          for (const ext of extensions) {
            const candidate = actualFile + ext;
            if (fs.existsSync(candidate)) {
              fileToRead = candidate;
              break;
            }
          }
        } else {
          fileToRead = actualFile;
        }

        if (fileToRead) {
          const reExports = extractReExports(fileToRead);
          if (reExports.length > 0) {
            barrelExportsFound++;
            console.log(
              `  📦 Found barrel export: ${actualFile} re-exports ${reExports.length} files`,
            );

            // Add all re-exported files as dependencies
            reExports.forEach((reExportPath) => {
              const reExportActualFile = findActualFile(
                reExportPath,
                allFiles.map((f) => normalizeFileName(f)),
              );
              if (
                reExportActualFile &&
                !allDependencies.includes(reExportPath)
              ) {
                allDependencies.push(reExportPath);
                additionalDependenciesFromBarrels++;
              }
            });
          }
        }
      }
    });

    dependencies[normalizedFile] = allDependencies;
  });

  console.log(
    `Built dependency graph for ${Object.keys(dependencies).length} files`,
  );
  console.log(
    `  📦 Found ${barrelExportsFound} barrel exports adding ${additionalDependenciesFromBarrels} additional dependencies`,
  );

  console.log(
    `\n${colors.purple}Step 3: Finding entry points...${colors.reset}`,
  );
  const entryPoints = findEntryPoints();
  console.log(`Found ${entryPoints.length} entry points:`);
  entryPoints.forEach((entry) => console.log(`  🎯 ${entry}`));

  console.log(
    `\n${colors.purple}Step 4: Performing reachability analysis...${colors.reset}`,
  );

  const visited = new Set();
  const toVisit = [...entryPoints];

  // BFS traversal
  while (toVisit.length > 0) {
    const current = toVisit.pop();

    if (visited.has(current)) continue;
    visited.add(current);

    // Add all dependencies of current file
    const deps = dependencies[current] || [];
    deps.forEach((dep) => {
      // Try to find the actual file that matches this dependency
      const actualFile = findActualFile(
        dep,
        allFiles.map((f) => normalizeFileName(f)),
      );
      if (actualFile && !visited.has(actualFile)) {
        toVisit.push(actualFile);
      }
    });
  }

  console.log(`Found ${visited.size} reachable files`);

  console.log(
    `\n${colors.purple}Step 5: Identifying unreachable files...${colors.reset}`,
  );

  const allNormalizedFiles = allFiles.map((f) => normalizeFileName(f));
  const unreachableFiles = allNormalizedFiles.filter(
    (file) => !visited.has(file),
  );

  console.log(
    `\n${colors.purple}Step 6: Analyzing hierarchical chains...${colors.reset}`,
  );

  const chainAnalysis = analyzeHierarchicalChains(
    unreachableFiles,
    dependencies,
    Array.from(visited),
  );

  console.log(`\n${colors.blue}📊 ANALYSIS RESULTS${colors.reset}`);
  console.log(`${colors.blue}===================${colors.reset}\n`);

  console.log(
    `${colors.green}✅ REACHABLE FILES: ${visited.size}${colors.reset}`,
  );
  console.log(
    `${colors.red}🗑️  UNREACHABLE FILES: ${unreachableFiles.length}${colors.reset}\n`,
  );

  // Show chain analysis summary
  const orphanedFiles = Object.values(chainAnalysis).filter(
    (c) => c.isOrphaned,
  );
  const falsePositives = Object.values(chainAnalysis).filter((c) =>
    c.summary.includes("FALSE POSITIVE"),
  );
  const transitiveDeadCode = Object.values(chainAnalysis).filter((c) =>
    c.summary.includes("Transitive dead code"),
  );

  console.log(
    `${colors.yellow}📋 HIERARCHICAL ANALYSIS BREAKDOWN:${colors.reset}`,
  );
  console.log(`  🔹 Orphaned files: ${orphanedFiles.length}`);
  console.log(`  🔹 False positives: ${falsePositives.length}`);
  console.log(`  🔹 Transitive dead code: ${transitiveDeadCode.length}\n`);

  if (unreachableFiles.length > 0) {
    console.log(
      `${colors.yellow}Sample unreachable files with chains (first 5):${colors.reset}`,
    );
    unreachableFiles.slice(0, 5).forEach((file) => {
      const analysis = chainAnalysis[file];
      console.log(`  🗑️  ${file}`);
      console.log(`      Summary: ${analysis.summary}`);

      if (analysis.chains.length > 0 && !analysis.isOrphaned) {
        const sampleChain = analysis.chains[0];
        console.log(`      Chain: ${sampleChain.path.join(" ← ")}`);
        console.log(
          `      Root: ${sampleChain.rootFile} (${
            sampleChain.isRootReachable ? "reachable" : "unreachable"
          })`,
        );
      }
      console.log("");
    });

    if (unreachableFiles.length > 5) {
      console.log(`  ... and ${unreachableFiles.length - 5} more`);
    }
  }

  // Output detailed chain analysis
  console.log(`\n${colors.blue}📈 DETAILED CHAIN ANALYSIS${colors.reset}`);
  console.log(`${colors.blue}===========================${colors.reset}\n`);

  // Show false positives first
  if (falsePositives.length > 0) {
    console.log(
      `${colors.red}❌ FALSE POSITIVES (${falsePositives.length}):${colors.reset}`,
    );
    falsePositives.slice(0, 3).forEach((fp) => {
      console.log(`  🚨 ${fp.file}`);
      console.log(`      ${fp.summary}`);
      fp.chains.forEach((chain) => {
        if (chain.isRootReachable) {
          console.log(`      🔗 ${chain.path.join(" ← ")} → REACHABLE ROOT`);
        }
      });
      console.log("");
    });
    if (falsePositives.length > 3) {
      console.log(
        `      ... and ${falsePositives.length - 3} more false positives`,
      );
    }
    console.log();
  }

  // Show transitive dead code examples
  if (transitiveDeadCode.length > 0) {
    console.log(
      `${colors.yellow}🔗 TRANSITIVE DEAD CODE (${transitiveDeadCode.length}):${colors.reset}`,
    );
    transitiveDeadCode.slice(0, 5).forEach((tdc) => {
      console.log(`  🗑️  ${tdc.file}`);
      console.log(`      ${tdc.summary}`);
      tdc.chains.forEach((chain) => {
        console.log(`      📈 ${chain.path.join(" ← ")} → UNREACHABLE ROOT`);
      });
      console.log("");
    });
    if (transitiveDeadCode.length > 5) {
      console.log(
        `      ... and ${transitiveDeadCode.length - 5} more transitive chains`,
      );
    }
    console.log();
  }

  // Return results for further analysis
  return {
    totalFiles: allFiles.length,
    reachableFiles: Array.from(visited),
    unreachableFiles: unreachableFiles,
    entryPoints: entryPoints,
    chainAnalysis: chainAnalysis,
    filesWithDynamicImports: filesWithDynamicImports,
  };
}

// Run the analysis
const results = analyzeHierarchical();

// Save results for further inspection
fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
console.log(`\n${colors.cyan}Results saved to ${outputFile}${colors.reset}`);

// Report on dynamic imports
if (filesWithDynamicImports.length > 0) {
  console.log(`\n${colors.yellow}⚠️ DYNAMIC IMPORTS WARNING${colors.reset}`);
  console.log(`${colors.yellow}======================${colors.reset}`);
  console.log(
    `Found ${filesWithDynamicImports.length} files with dynamic imports that may not be fully analyzed:`,
  );
  filesWithDynamicImports.forEach((file) => {
    console.log(`  - ${file}`);
  });
  console.log(
    `\n${colors.yellow}Note: Dynamic imports could cause false positives in the dead code analysis.${colors.reset}`,
  );
  console.log(
    `${colors.yellow}Some files marked as "unreachable" might actually be loaded at runtime.${colors.reset}`,
  );
}

// Function to trace specific file or function usage for debugging
function traceFileUsage(targetFile, results) {
  console.log(
    `\n${colors.purple}🔍 TRACING FILE: ${targetFile}${colors.reset}`,
  );
  console.log(
    `${colors.purple}==============================${colors.reset}\n`,
  );

  const normalizedTarget = normalizeFileName(targetFile);

  // Check if file is reachable
  const isReachable = results.reachableFiles.includes(normalizedTarget);
  console.log(
    `Status: ${
      isReachable
        ? colors.green + "✅ REACHABLE"
        : colors.red + "❌ UNREACHABLE"
    }${colors.reset}`,
  );

  // Check if it's an entry point
  const isEntryPoint = results.entryPoints.includes(normalizedTarget);
  if (isEntryPoint) {
    console.log(`${colors.blue}🎯 This is an ENTRY POINT${colors.reset}`);
  }

  // Show chain analysis if unreachable
  if (!isReachable && results.chainAnalysis[normalizedTarget]) {
    const analysis = results.chainAnalysis[normalizedTarget];
    console.log(`\nChain Analysis:`);
    console.log(`  Summary: ${analysis.summary}`);

    if (analysis.chains.length > 0) {
      console.log(`  Import Chains:`);
      analysis.chains.forEach((chain, i) => {
        console.log(`    ${i + 1}. ${chain.path.join(" ← ")}`);
        console.log(
          `       Root: ${chain.rootFile} (${
            chain.isRootReachable ? "reachable" : "unreachable"
          })`,
        );
      });
    }

    if (analysis.importedBy.length > 0) {
      console.log(`  Imported by: ${analysis.importedBy.join(", ")}`);
    }
  }

  return isReachable;
}

// If a specific file is provided for tracing, run the tracing function
if (traceFile) {
  traceFileUsage(traceFile, results);
}
