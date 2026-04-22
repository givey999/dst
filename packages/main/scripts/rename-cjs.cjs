#!/usr/bin/env node
// Renames all dist/*.js -> dist/*.cjs and updates require() calls within them.
"use strict";
const fs = require("fs");
const path = require("path");

const distDir = path.resolve(__dirname, "../dist");
const files = fs.readdirSync(distDir);

// First pass: rename .js -> .cjs and .js.map -> .cjs.map
for (const file of files) {
  if (file.endsWith(".js") && !file.endsWith(".d.ts")) {
    const oldPath = path.join(distDir, file);
    const newName = file.replace(/\.js$/, ".cjs");
    const newPath = path.join(distDir, newName);
    fs.renameSync(oldPath, newPath);
  }
  if (file.endsWith(".js.map")) {
    const oldPath = path.join(distDir, file);
    const newName = file.replace(/\.js\.map$/, ".cjs.map");
    const newPath = path.join(distDir, newName);
    fs.renameSync(oldPath, newPath);
  }
}

// Second pass: update require("./foo.js") -> require("./foo.cjs") in all .cjs files
const cjsFiles = fs.readdirSync(distDir).filter(f => f.endsWith(".cjs"));
for (const file of cjsFiles) {
  const filePath = path.join(distDir, file);
  let content = fs.readFileSync(filePath, "utf8");
  // Replace local require paths: require("./foo.js") -> require("./foo.cjs")
  content = content.replace(/require\(["'](\.[^"']+)\.js["']\)/g, (match, p1) => {
    return `require("${p1}.cjs")`;
  });
  // Also fix sourceMappingURL comments
  content = content.replace(/\/\/# sourceMappingURL=(.+)\.js\.map/, "//# sourceMappingURL=$1.cjs.map");
  fs.writeFileSync(filePath, content, "utf8");
}

console.log("CJS rename complete.");
