#!/usr/bin/env node
/**
 * Post-build script to rewrite @prisma/client imports to relative paths
 * This is needed because TypeScript path aliases don't work at runtime
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

function rewriteImports(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  // Calculate relative path from this file to prisma/generated/client
  const relativePath = path.relative(
    path.dirname(filePath),
    path.join(__dirname, '..', 'prisma', 'generated', 'client')
  ).replace(/\\/g, '/'); // Normalize path separators
  
  // Rewrite @prisma/client imports to relative paths
  // Match: from "@prisma/client" or from '@prisma/client'
  content = content.replace(
    /from\s+["']@prisma\/client["']/g,
    `from "${relativePath.startsWith('.') ? relativePath : './' + relativePath}"`
  );
  
  // Also handle require() calls
  content = content.replace(
    /require\(["']@prisma\/client["']\)/g,
    `require("${relativePath.startsWith('.') ? relativePath : './' + relativePath}")`
  );
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Rewrote imports in ${path.relative(distDir, filePath)}`);
  }
}

function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      rewriteImports(fullPath);
    }
  }
}

if (fs.existsSync(distDir)) {
  console.log('Rewriting @prisma/client imports to relative paths...');
  processDirectory(distDir);
  console.log('Done!');
} else {
  console.error(`Dist directory not found: ${distDir}`);
  process.exit(1);
}

