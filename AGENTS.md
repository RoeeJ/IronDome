# AGENTS.md - Iron Dome Simulator

## Build/Test Commands
```bash
bun install          # Install dependencies (use Bun, not npm/yarn/pnpm)
bun dev             # Dev server with HMR on port 3000
bun run build       # Production build
bun test            # Run all tests
bun test <file>     # Run single test file (e.g., bun test tests/simple-debug.test.ts)
bun run lint        # Check code style
bun run lint:fix    # Auto-fix style issues
bun run typecheck   # TypeScript type checking
```

## Code Style
- **Runtime**: Always use Bun instead of Node.js (see .cursor/rules/)
- **Imports**: Use `@/` alias for src imports (e.g., `import { Game } from '@/game/Game'`)
- **Formatting**: Prettier with single quotes, semicolons, 100 char width, 2 space indent
- **Types**: Strict TypeScript, prefer interfaces over types, avoid `any`
- **Naming**: PascalCase for classes/components, camelCase for functions/variables
- **React**: Functional components only, no class components
- **Three.js**: Cache materials/geometries, dispose properly, use instancing for performance
- **Error Handling**: Log errors with context, graceful degradation for 3D features
- **Testing**: Use Bun test runner with describe/test blocks