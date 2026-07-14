# Contributing

Open an issue before making broad API or protocol changes. Keep pull requests
focused and include tests for behavior changes.

## Development

```sh
npm ci
npm run check
```

Generated L1 and L2 interface files must be refreshed through their scripts; do
not edit generated output directly. See `README.md` for the ownership boundary
between this public SDK and the private contracts project.

By contributing, you agree that your contribution is licensed under MPL-2.0.
