# Contributing to Horizon Engine

Thanks for contributing.

## Setup

```bash
pnpm install
pnpm check
pnpm test
```

## Local Development

Use the root scripts to run the example apps:

```bash
pnpm dev
pnpm dev:large
pnpm dev:pbr
pnpm dev:anim
pnpm dev:editor
```

## Guidelines

- Keep changes focused and subsystem-oriented.
- Prefer TypeScript-first, data-oriented APIs.
- Preserve package boundaries when adding new features.
- Update docs when behavior or workflows change.
- Run `pnpm check` before opening a PR.

## Roadmap

The project is developed in phases. If you are contributing a large feature, align it to the current roadmap phase in `README.md`.
