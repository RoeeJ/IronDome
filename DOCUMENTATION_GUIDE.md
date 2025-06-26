# Documentation Guide - Iron Dome Simulator

## Overview

This guide explains the documentation structure for the Iron Dome Simulator project. The documentation has been consolidated and reorganized to reflect the actual ~80% completion state of the project.

## 📁 Documentation Structure

### Root Level Documentation
- **README.md** - User-facing project overview with features and setup
- **CHANGELOG.md** - Version history and recent changes
- **CLAUDE.md** - AI assistant guidance (most important for development)
- **DOCUMENTATION_GUIDE.md** - This file

### /roadmap - Strategic Planning
- **ROADMAP_STATUS_2025.md** - Current project status (~80% complete)
- **REMAINING_WORK.md** - Clear list of what's actually left to implement
- **NEXT_PRIORITIES.md** - Development priorities (being updated)
- Other files are historical/reference

### /docs - Technical Documentation
- **Active Documentation**:
  - Architecture and system design docs
  - Performance optimization guides
  - Integration documentation
  
- **/archive** - Completed or outdated documentation

### /notes - Implementation Notes
- **Active Notes**:
  - physics-calculations.md (still relevant formulas)
  - Current implementation guides
  
- **/archive** - Completed implementation notes

### /unity - Unity Port Documentation
- Complete guide for porting to Unity (created June 25, 2025)
- Step-by-step porting instructions

## 🎯 Key Documents for Developers

1. **CLAUDE.md** - Start here! Contains:
   - Current feature list
   - What's actually implemented vs planned
   - Common development tasks
   - Performance guidelines

2. **REMAINING_WORK.md** - Shows the ~20% left:
   - Audio assets needed
   - Scenario integration
   - Object pooling completion
   - Final polish items

3. **README.md** - Updated with:
   - All implemented features
   - Mobile support documentation
   - Actual controls and shortcuts

## ⚠️ Important Notes

### Documentation vs Reality
- The project is **much more complete** than early docs suggest
- Mobile support is **fully implemented** (was listed as #1 priority)
- City generation is **complete** with hexagonal districts
- Most "planned" features are **already working**

### Common Misconceptions
- ❌ "Project in initial setup" → ✅ ~80% production-ready
- ❌ "Mobile support needed" → ✅ Full touch controls working
- ❌ "Basic threat types" → ✅ 8+ threat variants implemented
- ❌ "Planning city generation" → ✅ Procedural city complete

### What's Actually Missing
1. **Audio files** (system is complete)
2. **Scenario wiring** (scenarios defined, not connected)
3. **Full object pooling** (partial implementation)
4. **Weather gameplay** (visuals done, physics integration needed)
5. **Final polish** (edge cases, cross-browser testing)

## 📝 Updating Documentation

When making changes:
1. Update CLAUDE.md first (AI assistants use this)
2. Update relevant technical docs
3. Keep CHANGELOG.md current
4. Don't update archived files

## 🗂️ Archived Documentation

Files in `/archive` directories are:
- Completed implementation notes
- Outdated roadmaps
- Historical planning documents
- Superseded technical specs

These are kept for reference but should not be updated.

## 🚀 Quick Start for New Developers

1. Read **CLAUDE.md** for project overview
2. Check **REMAINING_WORK.md** for what needs doing
3. Review **README.md** for setup instructions
4. Use sandbox mode (game UI) for testing
5. Enable debug mode with `?debug=true`

## 📊 Project Metrics

- **Completion**: ~80% (not 65% as some docs state)
- **Timeline to v1.0**: ~3 weeks
- **Major Systems**: All complete
- **Remaining Work**: Mostly content and polish

---

*Last Updated: January 26, 2025*