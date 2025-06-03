const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 3005;
const TARGET_DIR = process.env.TARGET_DIR || process.cwd();

console.log(`🎯 Default target directory: ${TARGET_DIR}`);

// MIME types for static files
const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

// Keep track of the current target directory that can be changed via API
let currentTargetDir = TARGET_DIR;

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return mimeTypes[ext] || "text/plain";
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("File not found");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Server error");
      }
    } else {
      res.writeHead(200, { "Content-Type": getContentType(filePath) });
      res.end(content);
    }
  });
}

function runAnalysis(targetDir = currentTargetDir) {
  return new Promise((resolve, reject) => {
    console.log(`📊 Running analysis on: ${targetDir}`);
    const child = spawn(
      "node",
      [
        path.join(__dirname, "hierarchical-analyzer-v2.js"),
        targetDir,
        path.join(targetDir, "hierarchical-analysis-results.json"),
      ],
      {
        cwd: targetDir, // Set working directory to target directory
      },
    );

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        // Log error output for debugging
        console.error("Analysis process error output:\n", errorOutput);
        reject(new Error(`Analysis failed with code ${code}: ${errorOutput}`));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // API Routes
    if (pathname === "/api/analysis") {
      if (req.method === "GET") {
        // Serve existing analysis results
        const analysisPath = path.join(
          currentTargetDir,
          "hierarchical-analysis-results.json",
        );
        if (fs.existsSync(analysisPath)) {
          serveStaticFile(res, analysisPath);
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "No analysis results found. Run analysis first.",
            }),
          );
        }
      } else if (req.method === "POST") {
        // Run new analysis
        try {
          const body = await new Promise((resolve) => {
            let data = "";
            req.on("data", (chunk) => (data += chunk));
            req.on("end", () => resolve(data));
          });

          const { targetDir } = JSON.parse(body || "{}");
          const analysisTargetDir = targetDir || currentTargetDir;

          if (targetDir) {
            // Update current target directory if provided
            currentTargetDir = targetDir;
          }

          await runAnalysis(analysisTargetDir);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              message: "Analysis completed",
              targetDir: analysisTargetDir,
            }),
          );
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      }
    } else if (pathname === "/api/delete-file" && req.method === "DELETE") {
      // Delete a single file
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { filePath } = JSON.parse(body);
          const extensions = [".js", ".jsx", ".ts", ".tsx"];
          let deleted = false;

          // Try with src/ prefix first
          for (const ext of extensions) {
            const fullPath = path.join(currentTargetDir, "src", filePath + ext);
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              deleted = true;
              break;
            }
          }

          // Try without src/ prefix
          if (!deleted) {
            for (const ext of extensions) {
              const altPath = path.join(currentTargetDir, filePath + ext);
              if (fs.existsSync(altPath)) {
                fs.unlinkSync(altPath);
                deleted = true;
                break;
              }
            }
          }

          if (deleted) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                message: `Deleted ${filePath}`,
              }),
            );
          } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `File not found: ${filePath}` }));
          }
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } else if (pathname === "/api/delete-files" && req.method === "DELETE") {
      // Delete multiple files
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { filePaths } = JSON.parse(body);
          const results = [];

          filePaths.forEach((filePath) => {
            const extensions = [".js", ".jsx", ".ts", ".tsx"];
            let deleted = false;

            // Try with src/ prefix first
            for (const ext of extensions) {
              const fullPath = path.join(
                currentTargetDir,
                "src",
                filePath + ext,
              );
              if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
                results.push({ file: filePath, success: true });
                deleted = true;
                break;
              }
            }

            // Try without src/ prefix
            if (!deleted) {
              for (const ext of extensions) {
                const altPath = path.join(currentTargetDir, filePath + ext);
                if (fs.existsSync(altPath)) {
                  fs.unlinkSync(altPath);
                  results.push({ file: filePath, success: true });
                  deleted = true;
                  break;
                }
              }
            }

            if (!deleted) {
              results.push({
                file: filePath,
                success: false,
                error: "File not found",
              });
            }
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ results }));
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } else if (pathname === "/api/generate-script" && req.method === "POST") {
      // Generate deletion script
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { filePaths } = JSON.parse(body);
          let script =
            "#!/bin/bash\n\n# Generated dead code deletion script\n\n";

          filePaths.forEach((filePath) => {
            script += `# Delete ${filePath}\n`;
            script += `find "${currentTargetDir}/src" -name "${path.basename(
              filePath,
            )}.*" -type f -delete 2>/dev/null || find "${currentTargetDir}" -name "${path.basename(
              filePath,
            )}.*" -type f -delete\n`;
          });

          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(script);
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } else if (pathname === "/api/target-directory" && req.method === "GET") {
      // Get current target directory
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ targetDir: currentTargetDir }));
    } else if (pathname === "/api/target-directory" && req.method === "POST") {
      // Set target directory
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { targetDir } = JSON.parse(body);
          const newTargetDir = path.resolve(targetDir);

          // Check if the new target directory exists
          if (!fs.existsSync(newTargetDir)) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Target directory not found" }));
            return;
          }

          currentTargetDir = newTargetDir;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              message: "Target directory updated",
              targetDir: currentTargetDir,
            }),
          );
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } else {
      // Static file serving
      let filePath;

      if (pathname === "/") {
        filePath = path.join(__dirname, "public", "index.html");
      } else {
        filePath = path.join(__dirname, "public", pathname);
      }

      serveStaticFile(res, filePath);
    }
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(
    `🚀 Dead Code Analyzer Server running at http://localhost:${PORT}`,
  );
  console.log(`📁 Serving from: ${__dirname}`);
  console.log(`🎯 Target directory: ${currentTargetDir}`);
});
