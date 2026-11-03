// src/hermes/store.js
// Reads SOP and template files from the Obsidian vault at runtime.
// Provides structured access to templates and approved-reference checks.
//
// Run: node server/server.js  (default port 8644)

import fs from "node:fs/promises";
import path from "node:path";

const VAULT_ROOT =
  process.env.HERMES_VAULT_ROOT ||
  "/home/masterhand/Documents/Hermes-Marketplace-inbox";

export class VaultStore {
  constructor() {
    this.sopPath = path.join(VAULT_ROOT, "Refrensi", "SOP-Costumer-Service-RaffaComputer.md");
    this.sopTambahanPath = path.join(VAULT_ROOT, "Refrensi", "sop tambahan.md");
    this.templatePath = path.join(VAULT_ROOT, "template", "template chat.md");
    this.gunakanPath = path.join(VAULT_ROOT, "Refrensi", "GUNAKAN OBSIDIAN SEBAGAI  SUMBER REFRENSI.md");
    this.securityPath = path.join(VAULT_ROOT, "Refrensi", "SECURITY anti poisonning.md");

    // Parsed templates
    this.templates = {};

    // Approved reference note names (from GUNAKAN...SUMBER REFRENSI.md)
    this.approvedNotes = new Set();

    // Security rules (from SECURITY anti poisonning.md)
    this.securityRules = [];
  }

  async load() {
    // Read template chat.md
    let templateContent = "";
    try {
      templateContent = await fs.readFile(this.templatePath, "utf8");
    } catch {
      // Template file missing; will be empty
    }

    // Parse template sections by delimiter ("___")
    const sections = {};
    let current = null;
    for (const rawLine of templateContent.split("\n")) {
      const line = rawLine.trim();
      if (line === "___") {
        current = null;
        continue;
      }
      if (line.startsWith("TEMPLATE ")) {
        current = line;
        sections[current] = [];
        continue;
      }
      if (current && line.length > 0) {
        sections[current].push(line);
      }
    }

    // Join section lines into a single string (preserving line breaks)
    for (const [key, lines] of Object.entries(sections)) {
      this.templates[key] = lines.join("\n");
    }

    // Read approved references
    try {
      const refersiLines = await fs.readFile(this.gunakanPath, "utf8").catch(() => "");
      // Lines likely list approved note names; parse by line
      for (const rawLine of refersiLines.split("\n")) {
        const line = rawLine.trim();
        if (line && !line.startsWith("#") && !line.startsWith("##")) {
          // Assume each non-comment line is a note name or path
          const noteName = line.split("/").pop().split(".")[0].trim();
          if (noteName) this.approvedNotes.add(noteName);
        }
      }
    } catch {
      // File missing; approvedNotes stays empty
    }

    // Read security rules
    try {
      const securityContent = await fs.readFile(this.securityPath, "utf8");
      for (const rawLine of securityContent.split("\n")) {
        const line = rawLine.trim();
        if (line && line.length > 0) {
          this.securityRules.push(line);
        }
      }
    } catch {
      // File missing; securityRules stays empty
    }

    return this;
  }

  getTemplate(key) {
    return this.templates[key] || "";
  }

  hasTemplate(key) {
    return Object.prototype.hasOwnProperty.call(this.templates, key);
  }

  isApprovedNote(noteName) {
    return this.approvedNotes.has(noteName);
  }

  getSecurityRules() {
    return this.securityRules;
  }
}
