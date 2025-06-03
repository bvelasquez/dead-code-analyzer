#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

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

const targetDir = process.argv[2] || process.cwd();
const port = process.argv[3] || 3001;

console.log(
  `${colors.blue}🚀 Dead Code Analyzer - Run Analysis & Serve${colors.reset}`,
);
console.log(
  `${colors.blue}===============================================${colors.reset}\n`,
);

console.log(`${colors.cyan}Target directory: ${targetDir}${colors.reset}`);
console.log(`${colors.cyan}Server port: ${port}${colors.reset}\n`);

// Step 1: Run the analysis
console.log(
  `${colors.purple}Step 1: Running hierarchical analysis...${colors.reset}`,
);

const analysisProcess = spawn(
  "node",
  [
    path.join(__dirname, "..", "hierarchical-analyzer-v2.js"),
    targetDir,
    path.join(__dirname, "hierarchical-analysis-results.json"),
  ],
  {
    stdio: "inherit",
  },
);

analysisProcess.on("close", (code) => {
  if (code !== 0) {
    console.error(
      `${colors.red}❌ Analysis failed with exit code ${code}${colors.reset}`,
    );
    process.exit(1);
  }

  console.log(
    `\n${colors.green}✅ Analysis completed successfully!${colors.reset}`,
  );

  // Check if analysis results exist
  const resultsPath = path.join(
    __dirname,
    "hierarchical-analysis-results.json",
  );
  if (!fs.existsSync(resultsPath)) {
    console.error(
      `${colors.red}❌ Analysis results file not found: ${resultsPath}${colors.reset}`,
    );
    process.exit(1);
  }

  // Step 2: Start the server
  console.log(
    `\n${colors.purple}Step 2: Starting web server...${colors.reset}`,
  );

  const serverProcess = spawn("node", [path.join(__dirname, "server.js")], {
    stdio: "inherit",
    env: { ...process.env, PORT: port, TARGET_DIR: targetDir },
  });

  // Handle server process
  serverProcess.on("close", (code) => {
    console.log(
      `\n${colors.yellow}Server exited with code ${code}${colors.reset}`,
    );
  });

  // Handle shutdown gracefully
  process.on("SIGINT", () => {
    console.log(`\n${colors.yellow}🛑 Shutting down...${colors.reset}`);
    serverProcess.kill("SIGINT");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log(`\n${colors.yellow}🛑 Shutting down...${colors.reset}`);
    serverProcess.kill("SIGTERM");
    process.exit(0);
  });
});

analysisProcess.on("error", (error) => {
  console.error(
    `${colors.red}❌ Failed to start analysis: ${error.message}${colors.reset}`,
  );
  process.exit(1);
});
