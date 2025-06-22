// Mock browser globals for testing
if (typeof window === 'undefined') {
  global.window = {
    location: {
      search: ''
    },
    requestAnimationFrame: (callback: Function) => {
      return setTimeout(callback, 16); // ~60fps
    },
    cancelAnimationFrame: (id: number) => {
      clearTimeout(id);
    }
  } as any;
}

// Mock performance if not available
if (typeof performance === 'undefined') {
  global.performance = {
    now: () => Date.now()
  } as any;
}