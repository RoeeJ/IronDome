// Test setup file - ensures globals are mocked before any imports
global.window = { 
  location: { 
    search: '' 
  } 
} as any

// Export to ensure this file is imported
export const testSetup = true